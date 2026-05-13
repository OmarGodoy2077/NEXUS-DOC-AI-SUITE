/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#000000',          // Negro puro (fondo principal)
          bgSecondary: '#1C1C1E', // Gris muy oscuro (tarjetas, sidebar)
          text: '#F5F5F7',        // Blanco suave
          textSecondary: '#A1A1A6',// Gris claro (texto secundario)
          border: '#38383A',      // Bordes tenues
          accent: '#2997FF',      // Azul vibrante de Apple Dark Mode
          accentHover: '#147CE5',
          success: '#32D74B',
          warning: '#FFD60A',     // Amarillo como el de tu imagen
          error: '#FF453A',
        }
      },
      borderRadius: {
        'apple': '12px',
        'apple-lg': '18px',
      },
      boxShadow: {
        'apple': '0 4px 24px rgba(0, 0, 0, 0.4)', // Sombra más intensa para modo oscuro
      }
    },
  },
  plugins: [],
}