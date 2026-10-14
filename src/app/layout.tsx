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
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}