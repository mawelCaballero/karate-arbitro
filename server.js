const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

const distPath = path.join(__dirname, 'dist/arbitro-karate/browser');

app.use(express.static(distPath));

app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
