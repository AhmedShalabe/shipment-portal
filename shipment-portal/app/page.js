'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Ship, Search, Plus, CheckCircle2, Paperclip, ExternalLink,
  X, Upload, Trash2, History, Users, Edit2
} from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const DEFAULT_DOCS = [
  { index: 1, name: 'Proforma Invoice', highlight: true },
  { index: 2, name: 'Client Payment Requests', highlight: false },
  { index: 3, name: 'Swifts', highlight: false },
  { index: 4, name: 'Inventory Statement', highlight: false },
  { index: 5, name: 'Commercial Invoice & Packing List', highlight: true },
  { index: 6, name: 'B/L', highlight: true, hasRef: true, refLabel: 'B/L number' },
  { index: 7, name: 'Custom Clearance Documents', highlight: true },
  { index: 8, name: 'Whole Logistics Document Pack', highlight: false },
  { index: 9, name: 'Document Tracking', highlight: true, hasRef: true, refLabel: 'Tracking number' },
];

export default function ShipmentPortal() {
  const [shipments, setShipments] = useState([]);
  const [clients, setClients] = useState([]);
  const [consignees, setConsignees] = useState([]);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [showNewShipment, setShowNewShipment] = useState(false);
  const [showClientsModal, setShowClientsModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logFilterShipment, setLogFilterShipment] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');

  // Forms state
  const [newClientName, setNewClientName] = useState('');
  const [newConsignee, setNewConsignee] = useState({ client_id: '', name: '', address: '', contact_details: '' });
  const [newShip, setNewShip] = useState({
    client_id: '', consignee_id: '', ucr: '', factory_name: 'Egypt Africa',
    port_of_loading: 'Alexandria', port_of_delivery: '', shipping_line: 'Mersek',
    containers: '', tracking_link: ''
  });

  useEffect(() => {
    fetchAllData();
  }, []);

  async function fetchAllData() {
    setLoading(true);
    const [{ data: sData }, { data: cData }, { data: conData }, { data: lData }] = await Promise.all([
      supabase.from('shipments').select('*, client:clients(*), consignee:consignees(*), documents:shipment_documents(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('name'),
      supabase.from('consignees').select('*, client:clients(name)').order('name'),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    setShipments(sData || []);
    setClients(cData || []);
    setConsignees(conData || []);
    setLogs(lData || []);
    setLoading(false);
  }

  async function addLog(shipmentId, shipmentLabel, action) {
    await supabase.from('activity_logs').insert({
      shipment_id: shipmentId,
      shipment_label: shipmentLabel,
      user_name: 'Shalaby',
      action
    });
  }

  // --- Clients & Consignees Actions ---
  async function handleAddClient(e) {
    e.preventDefault();
    if (!newClientName.trim()) return;
    await supabase.from('clients').insert({ name: newClientName.trim() });
    setNewClientName('');
    fetchAllData();
  }

  async function handleAddConsignee(e) {
    e.preventDefault();
    if (!newConsignee.client_id || !newConsignee.name.trim()) return;
    await supabase.from('consignees').insert(newConsignee);
    setNewConsignee({ client_id: '', name: '', address: '', contact_details: '' });
    fetchAllData();
  }

  // --- Shipment Actions ---
  async function handleCreateShipment(e) {
    e.preventDefault();
    const containersArr = newShip.containers.split(',').map(c => c.trim()).filter(Boolean);
    const { data: created, error } = await supabase.from('shipments').insert({
      ...newShip,
      containers: containersArr
    }).select('*, client:clients(name)').single();

    if (error || !created) return alert('Error creating shipment: ' + error?.message);

    // Create 9 default document rows
    const docRows = DEFAULT_DOCS.map(d => ({
      shipment_id: created.id,
      doc_index: d.index,
      doc_name: d.name,
      status: 'Missing'
    }));
    await supabase.from('shipment_documents').insert(docRows);

    const label = `${created.client?.name} · ${created.ucr}`;
    await addLog(created.id, label, 'Created shipment');

    setShowNewShipment(false);
    setNewShip({
      client_id: '', consignee_id: '', ucr: '', factory_name: 'Egypt Africa',
      port_of_loading: 'Alexandria', port_of_delivery: '', shipping_line: 'Mersek',
      containers: '', tracking_link: ''
    });
    fetchAllData();
  }

  async function handleFileUpload(shipment, doc, file) {
    if (!file) return;
    const path = `${shipment.id}/${doc.doc_index}_${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('shipment-files').upload(path, file);
    if (upErr) return alert('Upload failed: ' + upErr.message);

    const { data: pubUrl } = supabase.storage.from('shipment-files').getPublicUrl(path);

    await supabase.from('shipment_documents').update({
      status: 'Attached',
      file_name: file.name,
      file_url: pubUrl.publicUrl,
      updated_at: new Date().toISOString()
    }).eq('id', doc.id);

    const label = `${shipment.client?.name} · ${shipment.ucr}`;
    await addLog(shipment.id, label, `Uploaded "${file.name}" to ${doc.doc_name}`);
    await refreshSelectedShipment(shipment.id);
    fetchAllData();
  }

  async function handleRemoveFile(shipment, doc) {
    await supabase.from('shipment_documents').update({
      status: 'Missing',
      file_name: null,
      file_url: null,
      updated_at: new Date().toISOString()
    }).eq('id', doc.id);

    const label = `${shipment.client?.name} · ${shipment.ucr}`;
    await addLog(shipment.id, label, `Removed "${doc.file_name}" from ${doc.doc_name}`);
    await refreshSelectedShipment(shipment.id);
    fetchAllData();
  }

  async function handleUpdateRefNumber(shipment, doc, val) {
    await supabase.from('shipment_documents').update({ reference_number: val }).eq('id', doc.id);
    const label = `${shipment.client?.name} · ${shipment.ucr}`;
    await addLog(shipment.id, label, `${doc.doc_name} number set to "${val}"`);
    await refreshSelectedShipment(shipment.id);
    fetchAllData();
  }

  async function handleDeleteShipment(shipment) {
    if (!confirm('Are you sure you want to delete this shipment?')) return;
    await supabase.from('shipments').delete().eq('id', shipment.id);
    setSelectedShipment(null);
    fetchAllData();
  }

  async function refreshSelectedShipment(id) {
    const { data } = await supabase
      .from('shipments')
      .select('*, client:clients(*), consignee:consignees(*), documents:shipment_documents(*)')
      .eq('id', id)
      .single();
    if (data) setSelectedShipment(data);
  }

  const filteredShipments = shipments.filter(s => {
    const q = search.toLowerCase();
    return (
      s.client?.name?.toLowerCase().includes(q) ||
      s.consignee?.name?.toLowerCase().includes(q) ||
      s.ucr?.toLowerCase().includes(q) ||
      s.containers?.some(c => c.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
          <Ship className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Shipment Documents Portal</h1>
          <p className="text-xs text-slate-500">{shipments.length} shipments</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search client, UCR, container, consignee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setShowLogsModal(true)}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
        >
          <History className="w-4 h-4" /> Activity log
        </button>
        <button
          onClick={() => setShowClientsModal(true)}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
        >
          <Users className="w-4 h-4" /> Clients & consignees
        </button>
        <button
          onClick={() => setShowNewShipment(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" /> New shipment
        </button>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 px-6 py-3 bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <div className="col-span-2">Client</div>
          <div className="col-span-3">Consignee</div>
          <div className="col-span-2">Route</div>
          <div className="col-span-1">Shipping Line</div>
          <div className="col-span-2">UCR</div>
          <div className="col-span-1">Containers</div>
          <div className="col-span-1 text-right">Files</div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading shipments...</div>
        ) : filteredShipments.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No shipments found. Click "+ New shipment" to start.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredShipments.map((shipment) => {
              const docs = (shipment.documents || []).sort((a, b) => a.doc_index - b.doc_index);
              const attachedCount = docs.filter(d => d.status === 'Attached').length;
              const highlightDocs = docs.filter(d => [1, 5, 6, 7, 9].includes(d.doc_index));
              const highlightComplete = highlightDocs.filter(d => d.status === 'Attached').length;

              return (
                <div
                  key={shipment.id}
                  onClick={() => setSelectedShipment(shipment)}
                  className="p-6 hover:bg-slate-50/60 transition cursor-pointer border-l-4 border-l-blue-600"
                >
                  {/* Top Row */}
                  <div className="grid grid-cols-12 gap-4 items-start mb-5">
                    <div className="col-span-2">
                      <div className="font-bold text-slate-900 text-sm">{shipment.client?.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Factory: {shipment.factory_name}</div>
                    </div>
                    <div className="col-span-3">
                      <div className="font-semibold text-slate-800 text-xs">{shipment.consignee?.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{shipment.consignee?.address}</div>
                    </div>
                    <div className="col-span-2 text-xs font-medium text-slate-700">
                      {shipment.port_of_loading} → <br />{shipment.port_of_delivery}
                    </div>
                    <div className="col-span-1 text-xs text-slate-700">{shipment.shipping_line}</div>
                    <div className="col-span-2 text-xs font-mono text-slate-700">{shipment.ucr}</div>
                    <div className="col-span-1 space-y-1" onClick={(e) => e.stopPropagation()}>
                      {(shipment.containers || []).map((c, idx) => (
                        <div key={idx} className="inline-block px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] font-mono text-slate-700">
                          {c}
                        </div>
                      ))}
                      {shipment.tracking_link && (
                        <a
                          href={shipment.tracking_link}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[11px] text-blue-600 hover:underline mt-1"
                        >
                          Track container ↗
                        </a>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      <span className="inline-block px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                        {attachedCount} / 9
                      </span>
                    </div>
                  </div>

                  {/* Checklist Box */}
                  <div className="bg-slate-50/90 rounded-xl p-4 border border-slate-200/70">
                    <div className="flex justify-between items-center text-[11px] font-semibold text-slate-400 mb-2">
                      <span>DOCUMENT CHECKLIST</span>
                      <span>{highlightComplete} OF 5 COMPLETE</span>
                    </div>
                    <div className="w-full h-1 bg-slate-200 rounded-full mb-3 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 transition-all"
                        style={{ width: `${(highlightComplete / 5) * 100}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-3">
                      {highlightDocs.map((doc) => {
                        const isDone = doc.status === 'Attached';
                        return (
                          <div
                            key={doc.id}
                            className={`p-3 rounded-xl border text-left transition ${
                              isDone
                                ? 'bg-emerald-50/70 border-emerald-400'
                                : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              {isDone ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                              ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-dashed border-slate-300 shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 leading-snug">{doc.doc_name}</div>
                                {isDone ? (
                                  <div className="mt-1 space-y-0.5">
                                    <div className="text-[11px] font-medium text-emerald-700">1 item attached</div>
                                    {doc.reference_number && (
                                      <div className="text-[11px] text-slate-600">No: {doc.reference_number}</div>
                                    )}
                                    {doc.file_name && (
                                      <div className="text-[11px] text-blue-600 truncate flex items-center gap-1">
                                        <Paperclip className="w-3 h-3 shrink-0" /> {doc.file_name}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-400 mt-0.5">Missing</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Shipment Details & 9 Documents */}
      {selectedShipment && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{selectedShipment.client?.name}</h2>
                <p className="text-xs text-slate-500 font-mono">UCR {selectedShipment.ucr}</p>
              </div>
              <button onClick={() => setSelectedShipment(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 mb-5 text-xs">
              <div>
                <span className="text-slate-400 block">Consignee</span>
                <span className="font-bold text-slate-800">{selectedShipment.consignee?.name}</span>
                <span className="text-slate-500 block mt-1">{selectedShipment.consignee?.address}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Route & Line</span>
                <span className="font-semibold text-slate-800">
                  {selectedShipment.port_of_loading} → {selectedShipment.port_of_delivery} ({selectedShipment.shipping_line})
                </span>
                <span className="text-slate-400 block mt-2">Containers</span>
                <span className="font-mono text-slate-800">{(selectedShipment.containers || []).join(', ')}</span>
              </div>
            </div>

            {/* 9 Documents List */}
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Documents checklist (9 items)</h3>
            <div className="space-y-2.5 mb-6">
              {(selectedShipment.documents || [])
                .sort((a, b) => a.doc_index - b.doc_index)
                .map((doc) => {
                  const meta = DEFAULT_DOCS.find(d => d.index === doc.doc_index);
                  const isAttached = doc.status === 'Attached';
                  return (
                    <div key={doc.id} className="p-3.5 rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">
                          {doc.doc_index}. {doc.doc_name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            isAttached ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {doc.status}
                          </span>
                          <label className="cursor-pointer px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium text-slate-700 flex items-center gap-1">
                            <Upload className="w-3 h-3" /> Upload
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => handleFileUpload(selectedShipment, doc, e.target.files?.[0])}
                            />
                          </label>
                        </div>
                      </div>

                      {meta?.hasRef && (
                        <div className="mt-2.5">
                          <label className="text-[11px] text-slate-400 block mb-1">{meta.refLabel}</label>
                          <input
                            type="text"
                            defaultValue={doc.reference_number || ''}
                            onBlur={(e) => handleUpdateRefNumber(selectedShipment, doc, e.target.value)}
                            placeholder={`Enter ${meta.refLabel}...`}
                            className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                          />
                        </div>
                      )}

                      {doc.file_name && (
                        <div className="mt-2.5 flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                          <a
                            href={doc.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1.5"
                          >
                            <Paperclip className="w-3.5 h-3.5" /> {doc.file_name}
                          </a>
                          <button
                            onClick={() => handleRemoveFile(selectedShipment, doc)}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <button
                onClick={() => handleDeleteShipment(selectedShipment)}
                className="text-xs text-red-600 hover:underline flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete shipment
              </button>
              <button
                onClick={() => setSelectedShipment(null)}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
              >
                Done & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: New Shipment */}
      {showNewShipment && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreateShipment} className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold">New Shipment</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Client *</label>
                <select
                  required
                  value={newShip.client_id}
                  onChange={(e) => setNewShip({ ...newShip, client_id: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                >
                  <option value="">— Select Client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Consignee *</label>
                <select
                  required
                  value={newShip.consignee_id}
                  onChange={(e) => setNewShip({ ...newShip, consignee_id: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                >
                  <option value="">— Select Consignee —</option>
                  {consignees
                    .filter(con => !newShip.client_id || con.client_id === newShip.client_id)
                    .map(con => <option key={con.id} value={con.id}>{con.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">UCR Number *</label>
                <input
                  required
                  value={newShip.ucr}
                  onChange={(e) => setNewShip({ ...newShip, ucr: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                  placeholder="769315844..."
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Shipping Line</label>
                <input
                  value={newShip.shipping_line}
                  onChange={(e) => setNewShip({ ...newShip, shipping_line: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Port of Loading</label>
                <input
                  value={newShip.port_of_loading}
                  onChange={(e) => setNewShip({ ...newShip, port_of_loading: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Port of Delivery *</label>
                <input
                  required
                  value={newShip.port_of_delivery}
                  onChange={(e) => setNewShip({ ...newShip, port_of_delivery: e.target.value })}
                  className="w-full mt-1 p-2 border rounded-lg text-sm"
                  placeholder="Tangier / Casablanca"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Containers (comma separated)</label>
              <input
                value={newShip.containers}
                onChange={(e) => setNewShip({ ...newShip, containers: e.target.value })}
                className="w-full mt-1 p-2 border rounded-lg text-sm"
                placeholder="MRKU8033909, MRKU7565912"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Container Tracking Link</label>
              <input
                value={newShip.tracking_link}
                onChange={(e) => setNewShip({ ...newShip, tracking_link: e.target.value })}
                className="w-full mt-1 p-2 border rounded-lg text-sm"
                placeholder="https://www.maersk.com/tracking/..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button type="button" onClick={() => setShowNewShipment(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">Create Shipment</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Clients & Consignees */}
      {showClientsModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl">
            <h2 className="text-lg font-bold">Clients & consignees</h2>
            <p className="text-xs text-slate-500 mb-4">Add them once, then choose them when creating a shipment.</p>

            {/* Add Client */}
            <form onSubmit={handleAddClient} className="flex gap-2 mb-4">
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Client name"
                className="flex-1 p-2 border rounded-lg text-sm"
              />
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Add client</button>
            </form>

            <div className="space-y-1.5 mb-6">
              {clients.map(c => (
                <div key={c.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg text-xs font-medium">
                  <span>{c.name}</span>
                  <button
                    onClick={async () => { await supabase.from('clients').delete().eq('id', c.id); fetchAllData(); }}
                    className="text-red-500 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            {/* Add Consignee */}
            <h3 className="text-sm font-bold mb-2">Consignees</h3>
            <form onSubmit={handleAddConsignee} className="space-y-2.5 mb-4">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newConsignee.client_id}
                  onChange={(e) => setNewConsignee({ ...newConsignee, client_id: e.target.value })}
                  className="p-2 border rounded-lg text-xs"
                >
                  <option value="">— Choose client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input
                  value={newConsignee.name}
                  onChange={(e) => setNewConsignee({ ...newConsignee, name: e.target.value })}
                  placeholder="Consignee name"
                  className="p-2 border rounded-lg text-xs"
                />
              </div>
              <input
                value={newConsignee.address}
                onChange={(e) => setNewConsignee({ ...newConsignee, address: e.target.value })}
                placeholder="Address"
                className="w-full p-2 border rounded-lg text-xs"
              />
              <textarea
                value={newConsignee.contact_details}
                onChange={(e) => setNewConsignee({ ...newConsignee, contact_details: e.target.value })}
                placeholder="Contact person, phone, email..."
                className="w-full p-2 border rounded-lg text-xs"
                rows={2}
              />
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium">Add consignee</button>
            </form>

            <div className="space-y-2 mb-4">
              {consignees.map(con => (
                <div key={con.id} className="p-2.5 bg-slate-50 rounded-lg text-xs flex justify-between items-start">
                  <div>
                    <span className="font-bold">{con.name}</span> · <span className="text-slate-500">{con.client?.name}</span>
                    <div className="text-slate-400 text-[11px]">{con.address}</div>
                  </div>
                  <button
                    onClick={async () => { await supabase.from('consignees').delete().eq('id', con.id); fetchAllData(); }}
                    className="text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => setShowClientsModal(false)} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Activity Log */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl">
            <h2 className="text-lg font-bold">Activity log</h2>
            <p className="text-xs text-slate-500 mb-4">All changes across shipments, newest first.</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <select
                value={logFilterShipment}
                onChange={(e) => setLogFilterShipment(e.target.value)}
                className="p-2 border rounded-lg text-xs"
              >
                <option value="ALL">All shipments</option>
                {shipments.map(s => (
                  <option key={s.id} value={s.id}>{s.client?.name} · {s.ucr}</option>
                ))}
              </select>
              <input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search activity..."
                className="p-2 border rounded-lg text-xs"
              />
            </div>

            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {logs
                .filter(l => logFilterShipment === 'ALL' || l.shipment_id === logFilterShipment)
                .filter(l => l.action.toLowerCase().includes(logSearch.toLowerCase()))
                .map(l => (
                  <div key={l.id} className="py-2.5 text-xs">
                    <span className="text-slate-400 font-mono mr-2">
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                    <span className="font-bold text-slate-800">{l.user_name}</span> —{' '}
                    <span className="text-slate-700">{l.action}</span>{' '}
                    {l.shipment_label && (
                      <span className="text-slate-400 font-medium">{l.shipment_label}</span>
                    )}
                  </div>
                ))}
            </div>

            <div className="flex justify-end mt-4 pt-3 border-t">
              <button onClick={() => setShowLogsModal(false)} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}