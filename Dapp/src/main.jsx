import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const container = document.getElementById('root');

function showFatal(message) {
  if (!container) return;
  container.innerHTML = '';
  const shell = document.createElement('div');
  shell.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'width:100%',
      'max-width:100%',
      'min-height:100vh',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:clamp(16px,4vw,32px)',
      'overflow-x:hidden',
      'background:#f8f7f3',
      'color:#1a1a17',
      'font-family:Inter,"Noto Sans Thai",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
      'font-size:14px',
      'line-height:1.65',
    ].join(';')
  );

  const card = document.createElement('div');
  card.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'width:100%',
      'max-width:440px',
      'padding:clamp(16px,3.2vw,28px)',
      'background:#ffffff',
      'border:1px solid #e6e4db',
      'border-radius:4px',
    ].join(';')
  );

  const label = document.createElement('p');
  label.textContent = 'Render error';
  label.setAttribute(
    'style',
    'margin:0 0 12px;font-size:10px;letter-spacing:.15em;text-transform:uppercase;font-weight:600;color:#a53a24'
  );

  const body = document.createElement('p');
  body.textContent = message;
  body.setAttribute('style', 'margin:0;color:#1a1a17;overflow-wrap:anywhere');

  card.appendChild(label);
  card.appendChild(body);
  shell.appendChild(card);
  container.appendChild(shell);
}

try {
  if (!container) {
    throw new Error('Mount point #root was not found in the document.');
  }
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (err) {
  showFatal(err && err.message ? err.message : 'The DApp could not be started.');
}
