let pyodide;
let pyodideReady = false;
let packagesInstalled = false; // Flyt denne til toppen

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
    
    // Load micropip immediately after Pyodide is ready
    console.log('Indlæser micropip...');
    await pyodide.loadPackage("micropip");
    console.log('micropip indlæst');
    
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

// Kombineret runPython funktion
async function runPython(code, outputId) {
  try {
    if (!pyodideReady) {
      document.getElementById(outputId).textContent = 'Initialiserer Python...';
      await initPyodide();
    }

    const outputElement = document.getElementById(outputId);
    
    // Install packages only once
    if (!packagesInstalled) {
      outputElement.innerHTML = "Installerer pakker...";
      
      // Install required packages silently
      await pyodide.runPythonAsync(`
        import micropip
        await micropip.install("pandas")
      `);
      
      packagesInstalled = true;
    }
    
    // Clear output and setup stdout capture
    outputElement.textContent = '';
    
    // Setup the environment first
    await pyodide.runPythonAsync(`
import sys
from io import StringIO
from pyodide.http import pyfetch
import pandas as pd

# Hidden URL fetching code
async def fetch_csv_data(url):
    response = await pyfetch(url)
    return await response.string()

# Provide default URL and csv_data
url = "https://raw.githubusercontent.com/jeppeFQ/sds1-lektion-1/refs/heads/master/resources/sales_data.csv"
csv_data = await fetch_csv_data(url)
    `);
    
    // Capture stdout for user code
    pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
    `);
    
    // Run user code
    pyodide.runPython(code);
    
    // Get output and restore stdout  
    const result = pyodide.runPython(`
output = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
output
    `);
    
    // Run the combined code
    outputElement.textContent = result || 'Kode kørt succesfuldt!';
    
  } catch (error) {
    document.getElementById(outputId).innerHTML = `<span style="color: red;">Fejl: ${error.message}</span>`;
    console.error('Fejl under Python-udførelse:', error);
  }
}

function resetPythonGlobals() {
  if (!pyodideReady) return;
  
  try {
    packagesInstalled = false; // Reset package installation flag
    
    pyodide.runPython(`
# Clear variables but keep built-ins
for name in list(globals().keys()):
    if not name.startswith('__') and name not in ['micropip', 'pandas', 'pd', 'pyfetch', 'StringIO']:
        del globals()[name]
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