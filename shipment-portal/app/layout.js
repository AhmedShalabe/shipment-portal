import './globals.css';

export const metadata = {
  title: 'Shipment Documents Portal',
  description: 'Export Shipment & Document Management',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}