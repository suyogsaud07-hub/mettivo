import './globals.css';

export const metadata = {
  title: 'Mettivo - Meet Your Kind of People',
  description: 'Premium International Dating & Connections Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#0D0A10', color: '#F2E9E4', minHeight: '100vh', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}