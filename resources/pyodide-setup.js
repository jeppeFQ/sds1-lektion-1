let pyodide;
let pyodideReady = false;

function updateStatus(type, message) {
  let statusDiv = document.getElementById('pyodide-status');
  
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'pyodide-status';
    statusDiv.className = 'pyodide-status';
    document.body.appendChild(statusDiv);
  }
  
  statusDiv.className = `pyodide-status status-${type}`;
  statusDiv.textContent = message;
  
  if (type === 'ready') {
    setTimeout(() => statusDiv.remove(), 4000);
  }
}

async function initPyodide() {
  if (pyodideReady) return pyodide;
  
  try {
    updateStatus('loading', 'Indlæser Python...');
    
    console.log('Indlæser Pyodide fra CDN...');
    
    if (typeof loadPyodide === 'undefined') {
      throw new Error('loadPyodide ikke fundet - tjek om pyodide.js er korrekt indlæst');
    }
    
    // Load from CDN
    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"
    });
    
    console.log('Pyodide indlæst korrekt');
    
    // Test basic functionality
    const testResult = pyodide.runPython('2 + 2');
    console.log('Testresultat:', testResult);
    
    if (testResult !== 4) {
      throw new Error('Pyodide-test mislykkedes');
    }
    
    pyodideReady = true;
    updateStatus('ready', 'Python klar!');
    
    document.querySelectorAll('.run-button').forEach(btn => {
      btn.disabled = false;
    });
    
    return pyodide;
    
  } catch (error) {
    console.error('Pyodide-initialisering mislykkedes:', error);
    updateStatus('error', 'Python-indlæsning mislykkedes: ' + error.message);
    throw error;
  }
}

async function runPython(code, outputId) {
  try {
    if (!pyodideReady) {
      document.getElementById(outputId).textContent = 'Initialiserer Python...';
      await initPyodide();
    }

    // Clear output before running new code
    document.getElementById(outputId).textContent = '';
    
    pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
    `);
    
    pyodide.runPython(code);
    
    const stdout = pyodide.runPython("sys.stdout.getvalue()");
    pyodide.runPython("sys.stdout = sys.__stdout__");
    
    document.getElementById(outputId).textContent = stdout || '(Intet output)';
    
  } catch (error) {
    document.getElementById(outputId).textContent = `Fejl: ${error.message}`;
    console.error('Fejl under Python-udførelse:', error);
  }
}

function resetPythonGlobals() {
  if (!pyodideReady) return;
  try {
    pyodide.runPython(`
globals().clear()
import builtins
globals().update({k: getattr(builtins, k) for k in dir(builtins)})
`);
    updateStatus('ready', 'Python-miljø nulstillet');
    console.log('Python global environment reset');
  } catch (error) {
    console.error('Fejl under nulstilling:', error);
    updateStatus('error', 'Fejl ved nulstilling: ' + error.message);
  }
}

// Wait for Reveal.js to be ready
Reveal.on('ready', () => {
  console.log('Reveal.js klar, starter Pyodide-initialisering...');
  
  document.querySelectorAll('.run-button').forEach(btn => {
    btn.disabled = true;
  });
  
  setTimeout(() => {
    initPyodide().catch(error => {
      console.error('Kunne ikke initialisere Pyodide:', error);
    });
  }, 500);
});