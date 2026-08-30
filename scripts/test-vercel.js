// Тест Vercel-функции локально
const app = require('../api/index.js');
app.listen(3003, () => console.log('vercel fn test on 3003'));
