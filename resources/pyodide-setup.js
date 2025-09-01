let pyodide;
let pyodideReady = false;
let packagesInstalled = false;

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

// Kombineret runPython funktion med fleksibel URL-håndtering
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
        await micropip.install(["pandas", "numpy", "matplotlib"])
      `);
      
      packagesInstalled = true;
    }
    
    // Clear output and setup environment
    outputElement.textContent = '';
    
    // Setup the environment with flexible URL handling
    await pyodide.runPythonAsync(`
import sys
from io import StringIO
from pyodide.http import pyfetch
import pandas as pd
import re

# Function to fetch CSV data from any URL
async def fetch_csv_data(url):
    try:
        response = await pyfetch(url)
        return await response.string()
    except Exception as e:
        print(f"Fejl ved hentning af {url}: {e}")
        return None

# Function to auto-fetch URLs found in code
async def auto_fetch_urls(code_text):
    # Find all URLs in the code
    url_pattern = r'url\s*=\s*["\']([^"\']+)["\']'
    urls = re.findall(url_pattern, code_text)
    
    # Fetch data for each URL and make available as csv_data
    if urls:
        main_url = urls[0]  # Use the first URL found
        csv_data = await fetch_csv_data(main_url)
        return csv_data
    return None

# Auto-detect and fetch URLs in user code
user_code_text = """${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"""
csv_data = await auto_fetch_urls(user_code_text)
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
    
    outputElement.textContent = result || 'Kode kørt succesfuldt!';
    
  } catch (error) {
    document.getElementById(outputId).innerHTML = `<span style="color: red;">Fejl: ${error.message}</span>`;
    console.error('Fejl under Python-udførelse:', error);
  }
}

// Advanced version for multiple URLs in one code block
async function runPythonAdvanced(code, outputId) {
  try {
    if (!pyodideReady) {
      await initPyodide();
    }

    const outputElement = document.getElementById(outputId);
    
    // Install packages if needed
    if (!packagesInstalled) {
      outputElement.innerHTML = "Installerer pakker...";
      await pyodide.runPythonAsync(`
        import micropip
        await micropip.install(["pandas", "numpy", "matplotlib"])
      `);
      packagesInstalled = true;
    }
    
    // Setup environment with support for multiple datasets
    await pyodide.runPythonAsync(`
import sys, re
from io import StringIO
from pyodide.http import pyfetch
import pandas as pd

# Dictionary to store multiple datasets
datasets = {}

async def fetch_and_store_data(var_name, url):
    """Fetch data from URL and store in datasets dictionary"""
    try:
        response = await pyfetch(url)
        csv_content = await response.string()
        datasets[var_name] = pd.read_csv(StringIO(csv_content))
        return True
    except Exception as e:
        print(f"Fejl ved hentning af {url}: {e}")
        return False

# Parse user code for URL assignments
user_code = """${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"""

# Find patterns like: variable_name = pd.read_csv("url")
pattern = r'(\\w+)\\s*=\\s*pd\\.read_csv\\(["\']([^"\']+)["\']\\)'
matches = re.findall(pattern, user_code)

for var_name, url in matches:
    success = await fetch_and_store_data(var_name, url)
    if success:
        # Make dataset available as the variable name
        globals()[var_name] = datasets[var_name]
        print(f"✓ Indlæst {var_name} fra {url}")

# Also handle direct URL assignments
url_pattern = r'url\\s*=\\s*["\']([^"\']+)["\']'
urls = re.findall(url_pattern, user_code)
if urls:
    response = await pyfetch(urls[0])
    csv_data = await response.string()
    print(f"✓ Hentet data fra {urls[0]}")
    `);
    
    // Capture output and run user code
    pyodide.runPython(`
sys.stdout = StringIO()
    `);
    
    pyodide.runPython(code);
    
    const result = pyodide.runPython(`
output = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
output
    `);
    
    outputElement.textContent = result || 'Kode kørt succesfuldt!';
    
  } catch (error) {
    document.getElementById(outputId).innerHTML = `<span style="color: red;">Fejl: ${error.message}</span>`;
  }
}

function resetPythonGlobals() {
  if (!pyodideReady) return;
  
  try {
    packagesInstalled = false;
    
    pyodide.runPython(`
# Clear variables but keep built-ins and datasets
for name in list(globals().keys()):
    if not name.startswith('__') and name not in ['micropip', 'pandas', 'pd', 'pyfetch', 'StringIO', 'datasets', 'fetch_and_store_data']:
        del globals()[name]
        
# Clear datasets dictionary
if 'datasets' in globals():
    datasets.clear()
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