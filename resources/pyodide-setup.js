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

async function runPython(code, outputId) {
  try {
    if (!pyodideReady) {
      document.getElementById(outputId).textContent = 'Initialiserer Python...';
      await initPyodide();
    }

    const outputElement = document.getElementById(outputId);
    
    // Install base packages only once
    if (!packagesInstalled) {
      outputElement.innerHTML = "Installerer grundpakker...";
      await pyodide.runPythonAsync(`
        import micropip
        await micropip.install(["pandas", "numpy", "matplotlib"])
      `);
      packagesInstalled = true;
    }
    
    // Detect additional packages needed in the code
    const packageMap = {
      'sklearn': 'scikit-learn',
      'geopandas': 'geopandas', 
      'networkx': 'networkx',
      'seaborn': 'seaborn'
    };
    
    const neededPackages = [];
    for (const [importName, packageName] of Object.entries(packageMap)) {
      if (code.includes(`import ${importName}`) || code.includes(`from ${importName}`)) {
        neededPackages.push(packageName);
      }
    }
    
    // Install additional packages if needed
    if (neededPackages.length > 0) {
      outputElement.innerHTML = `Installerer ${neededPackages.join(', ')}...`;
      for (const pkg of neededPackages) {
        try {
          await pyodide.runPythonAsync(`
            import micropip
            await micropip.install("${pkg}")
          `);
          console.log(`Installed ${pkg}`);
        } catch (error) {
          console.warn(`Could not install ${pkg}:`, error);
        }
      }
    }
    
    outputElement.textContent = '';
    
    // Setup environment once
    if (!pyodide.globals.get('env_setup')) {
      await pyodide.runPythonAsync(`
import sys
from io import StringIO
from pyodide.http import pyfetch
import pandas as pd

# Setup matplotlib for web display
import matplotlib
matplotlib.use('AGG')  # Use Anti-Grain Geometry backend
import matplotlib.pyplot as plt
from io import BytesIO
import base64

# Function to display plots in HTML
def show_plot():
    buf = BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode()
    plt.close()  # Close the plot to free memory
    
    # Create HTML img tag
    html_img = f'<img src="data:image/png;base64,{img_base64}" style="max-width:100%; height:auto;">'
    print("PLOT_HTML:" + html_img)  # Special marker for JS to detect
    return html_img

# Override plt.show() to use our custom function
original_show = plt.show
plt.show = lambda: show_plot()

env_setup = True
      `);
    }
    
    // Pre-process the code to handle URLs
    let processedCode = code;
    
    // Find URLs in the code
    const urlPattern = /url\s*=\s*["']([^"']+)["']/g;
    const urls = [];
    let match;
    
    while ((match = urlPattern.exec(code)) !== null) {
      urls.push(match[1]);
    }
    
    // If we found URLs, fetch them and modify the code
    if (urls.length > 0) {
      // Fetch the data first
      await pyodide.runPythonAsync(`
# Fetch data from URL
response = await pyfetch("${urls[0]}")
csv_data = await response.string()
      `);
      
      // Replace pd.read_csv(url) with pd.read_csv(StringIO(csv_data))
      processedCode = processedCode.replace(
        /pd\.read_csv\(url\)/g, 
        'pd.read_csv(StringIO(csv_data))'
      );
      
      // Also replace direct URL usage in pd.read_csv
      processedCode = processedCode.replace(
        /pd\.read_csv\(["']([^"']+)["']\)/g,
        'pd.read_csv(StringIO(csv_data))'
      );
    }
    
    // Capture stdout
    pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
    `);
    
    // Run the processed code
    pyodide.runPython(processedCode);
    
    // Get output and handle plots
    const result = pyodide.runPython(`
output = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
output
    `);
    
    // Check if output contains plot HTML
    if (result && result.includes('PLOT_HTML:')) {
      const parts = result.split('PLOT_HTML:');
      const textOutput = parts[0].trim();
      const plotHtml = parts[1];
      
      // Display text output if any
      if (textOutput) {
        outputElement.innerHTML = `<pre>${textOutput}</pre>${plotHtml}`;
      } else {
        outputElement.innerHTML = plotHtml;
      }
    } else {
      outputElement.textContent = result || 'Kode kørt succesfuldt!';
    }
    
  } catch (error) {
    document.getElementById(outputId).innerHTML = `<span style="color: red;">Fejl: ${error.message}</span>`;
    console.error('Fejl under Python-udførelse:', error);
  }
}

function resetPythonGlobals() {
  if (!pyodideReady) return;
  
  try {
    pyodide.runPython(`
# Clear variables but keep built-ins
for name in list(globals().keys()):
    if not name.startswith('__') and name not in [
        'micropip', 'pandas', 'pd', 'pyfetch', 'StringIO', 
        'env_setup', 'plt', 'matplotlib', 'numpy', 'np'
    ]:
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