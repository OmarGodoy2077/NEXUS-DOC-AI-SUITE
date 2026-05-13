import mockData from '../data/mockData.json';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const mockAPI = {
  // Simula Gemini Flash 2.5 extrayendo entidades
  processDocument: async (file) => {
    await sleep(2500);
    return {
      id: `DOC-${Math.floor(Math.random() * 1000)}`,
      name: file.name,
      status: 'processed',
      confidence: 0.99,
      extractedData: {
        info: "Datos extraídos mediante Gemini Flash 2.5",
        summary: "Análisis semántico completado exitosamente."
      }
    };
  },

  semanticSearch: async (query) => {
    await sleep(1800);
    return mockData.documents.map(doc => ({
      ...doc,
      relevance: Math.random() * 100
    })).sort((a, b) => b.relevance - a.relevance);
  },

  getDashboardMetrics: async () => {
    await sleep(800);
    return mockData.metrics;
  },

  getRecentDocuments: async () => {
    await sleep(600);
    return mockData.documents;
  },

  getDocumentById: async (id) => {
    await sleep(500);
    return mockData.documents.find(doc => doc.id === id);
  }
};

// TODO: Reemplazar con fetch('/api/...') cuando el backend de producción esté listo