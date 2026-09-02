let pyodide;
let pyodideReady = false;
let baseSetupDone = false;
const installedPackages = new Set();

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

async function installPackage(pkg) {
  if (installedPackages.has(pkg)) return true;

  try {
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("${pkg}")
    `);
    installedPackages.add(pkg);
    console.log(`Installeret: ${pkg}`);
    return true;
  } catch (error) {
    console.warn(`Kunne ikke installere ${pkg}:`, error);
    return false;
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

    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"
    });

    console.log('Pyodide indlæst korrekt');

    console.log('Indlæser micropip...');
    await pyodide.loadPackage("micropip");
    console.log('micropip indlæst');

    const testResult = pyodide.runPython('2 + 2');
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

async function setupEnvironment(outputElement) {
  if (baseSetupDone) return;

  outputElement.innerHTML = "Installerer grundpakker...";

  // Indbyggede Pyodide-pakker (hurtigere end micropip)
  try {
    await pyodide.loadPackage(["pandas", "numpy", "matplotlib"]);
    ["pandas", "numpy", "matplotlib"].forEach(p => installedPackages.add(p));
  } catch (error) {
    console.warn('Kunne ikke indlæse alle grundpakker:', error);
  }

  // vaderSentiment har leksikonet med i pakken - ingen download nødvendig
  updateStatus('loading', 'Installerer sentiment-analyse...');
  outputElement.innerHTML = "Installerer sentiment-analyse...";
  await installPackage("vaderSentiment");

  await pyodide.runPythonAsync(`
import sys
from io import StringIO, BytesIO
import base64
from pyodide.http import pyfetch
import pandas as pd

import matplotlib
matplotlib.use('AGG')
import matplotlib.pyplot as plt


def show_plot():
    buf = BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode()
    plt.close()
    html_img = f'<img src="data:image/png;base64,{img_base64}" style="max-width:100%; height:auto;">'
    print("PLOT_HTML:" + html_img)
    return html_img


plt.show = lambda *args, **kwargs: show_plot()


class SimpleSentimentAnalyzer:
    def __init__(self):
        self.positive_words = {
            'god', 'godt', 'gode', 'fantastisk', 'fremragende', 'perfekt',
            'dejlig', 'vidunderlig', 'glimrende', 'super', 'elsker', 'glad',
            'excellent', 'amazing', 'wonderful', 'fantastic', 'great', 'good',
            'love', 'like', 'happy', 'awesome', 'perfect', 'brilliant', 'outstanding'
        }
        self.negative_words = {
            'dårlig', 'forfærdelig', 'skrækkelig', 'frygtelig', 'hader',
            'sur', 'trist', 'skuffet', 'vred', 'utilfreds', 'værst',
            'bad', 'terrible', 'awful', 'horrible', 'hate', 'sad', 'angry',
            'disappointed', 'poor', 'worst', 'disgusting', 'pathetic'
        }
        self.intensifiers = {
            'meget': 1.5, 'rigtig': 1.3, 'virkelig': 1.3, 'super': 1.5,
            'extremely': 1.5, 'very': 1.3, 'really': 1.3, 'quite': 1.2
        }
        self.negations = {'ikke', 'aldrig', 'ingen', 'nej', 'not', 'never', 'no', 'nothing'}

    def polarity_scores(self, text):
        if not text:
            return {'neg': 0.0, 'neu': 1.0, 'pos': 0.0, 'compound': 0.0}

        words = text.lower().replace('!', '').replace('?', '').replace('.', '').split()
        pos_score = 0
        neg_score = 0
        word_count = len(words)

        for i, word in enumerate(words):
            negated = any(neg_word in words[max(0, i - 2):i] for neg_word in self.negations)

            intensity = 1.0
            for j in range(max(0, i - 2), i):
                if words[j] in self.intensifiers:
                    intensity = self.intensifiers[words[j]]
                    break

            if word in self.positive_words:
                score = 1.0 * intensity
                if negated:
                    neg_score += score
                else:
                    pos_score += score
            elif word in self.negative_words:
                score = 1.0 * intensity
                if negated:
                    pos_score += score
                else:
                    neg_score += score

        exclamation_count = text.count('!')
        if exclamation_count > 0:
            emphasis = min(0.3, exclamation_count * 0.1)
            if pos_score > neg_score:
                pos_score += emphasis
            else:
                neg_score += emphasis

        if word_count > 0:
            pos_norm = pos_score / word_count
            neg_norm = neg_score / word_count
            neu_norm = max(0, 1 - (pos_norm + neg_norm))
        else:
            pos_norm = neg_norm = neu_norm = 0

        compound = (pos_score - neg_score) / max(word_count, 1)
        compound = max(-1, min(1, compound))

        return {
            'neg': round(neg_norm, 3),
            'neu': round(neu_norm, 3),
            'pos': round(pos_norm, 3),
            'compound': round(compound, 3)
        }


fallback_analyzer = SimpleSentimentAnalyzer()
analyzer = fallback_analyzer

# Bemærk: except Exception, ikke ImportError. NLTK's VADER importerer fint,
# men fejler med LookupError i __init__ hvis leksikonet mangler.
try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    analyzer = SentimentIntensityAnalyzer()
    print("vaderSentiment analyzer indlæst")
except Exception as first_error:
    try:
        from nltk.sentiment.vader import SentimentIntensityAnalyzer
        analyzer = SentimentIntensityAnalyzer()
        print("NLTK VADER analyzer indlæst")
    except Exception:
        print(f"Bruger indbygget fallback-analyzer ({type(first_error).__name__})")

import builtins
builtins.analyzer = analyzer
builtins.show_plot = show_plot

env_setup = True
  `);

  baseSetupDone = true;
  console.log('Miljøopsætning færdig');
  updateStatus('ready', 'Alle pakker installeret!');
}

const PACKAGE_MAP = {
  'sklearn': 'scikit-learn',
  'geopandas': 'geopandas',
  'networkx': 'networkx',
  'seaborn': 'seaborn',
  'textblob': 'textblob',
  'vaderSentiment': 'vaderSentiment',
  'wordcloud': 'wordcloud',
  'plotly': 'plotly',
  'bokeh': 'bokeh'
};

const FALLBACK_DATA_CODE = `
# Fallback-data i Amazon review-format
import pandas as pd

sample_data = {
    'review': [
        "This product exceeded my expectations! Amazing quality and fast delivery. Worth every penny!",
        "Absolute garbage. Broke within hours of use. Complete waste of money and time.",
        "Pretty decent for the price point. Nothing extraordinary but gets the job done adequately.",
        "Outstanding quality! Best purchase I've made this year. Highly recommend to everyone.",
        "Terrible customer service experience. Product arrived damaged and return process was nightmare.",
        "Great value for money proposition. Quality exceeds expectations for this price range.",
        "Somewhat disappointing overall. Expected much better quality based on reviews and price point.",
        "Perfect in every way! Exactly what I needed. Will definitely purchase again soon.",
        "Not worth the investment. Cheap materials and poor construction quality throughout.",
        "Excellent product with incredibly fast shipping! Great packaging and customer care.",
        "Average product but significantly overpriced. Better alternatives available in market.",
        "Fantastic quality and attention to detail! Company clearly cares about customer satisfaction.",
        "Received defective item unfortunately. Had to return immediately for full refund.",
        "Good product overall with minor issues. Generally satisfied with purchase decision.",
        "Absolutely love this purchase! Exceeded expectations in every possible way imaginable!",
        "Poor build quality evident immediately. Would not recommend to anyone unfortunately.",
        "Solid product that delivers exactly what promised. No complaints or issues whatsoever.",
        "Disappointing experience overall unfortunately. Product did not meet basic expectations.",
        "Amazing customer support team! Product works perfectly and arrived quickly as promised.",
        "Waste of money completely. Save yourself trouble and buy something else instead."
    ],
    'sentiment': [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0],
    'rating': [5, 1, 3, 5, 1, 4, 2, 5, 1, 5, 3, 5, 1, 4, 5, 2, 4, 2, 5, 1]
}

df = pd.DataFrame(sample_data)
print("Bruger indbygget eksempeldata")
print(f"Datasæt: {df.shape}")
`;

function detectUrls(code) {
  const urlPatterns = [
    /url\s*=\s*["']([^"']+)["']/g,
    /pd\.read_csv\(\s*["']([^"']*https?:\/\/[^"']+)["']/g,
    /["']([^"']*https?:\/\/[^"']*\.(?:csv|tsv)[^"']*)["']/g
  ];

  const urls = new Set();
  urlPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      urls.add(match[1]);
    }
  });
  return Array.from(urls);
}

async function runPython(code, outputId) {
  const outputElement = document.getElementById(outputId);

  try {
    if (!pyodideReady) {
      outputElement.textContent = 'Initialiserer Python...';
      await initPyodide();
    }

    await setupEnvironment(outputElement);

    // Ekstra pakker ud fra imports i koden
    const needed = [];
    for (const [importName, packageName] of Object.entries(PACKAGE_MAP)) {
      const used = code.includes(`import ${importName}`) || code.includes(`from ${importName}`);
      if (used && !installedPackages.has(packageName)) {
        needed.push(packageName);
      }
    }

    if (needed.length > 0) {
      outputElement.innerHTML = `Installerer ${needed.join(', ')}...`;
      for (const pkg of needed) {
        await installPackage(pkg);
      }
    }

    let processedCode = code;
    const urls = detectUrls(code);

    if (urls.length > 0) {
      outputElement.innerHTML = `Henter data fra URL: ${urls[0]}...`;

      try {
        await pyodide.runPythonAsync(`
response = await pyfetch("${urls[0]}")
if response.status != 200:
    raise Exception(f"HTTP {response.status}: kunne ikke hente data")

csv_data = await response.string()
print(f"Hentede {len(csv_data)} tegn fra URL")
        `);

        processedCode = processedCode
          .replace(/^\s*url\s*=\s*["'][^"']+["'].*$/gm, '# URL-data hentet ovenfor')
          .replace(
            /pd\.read_csv\(\s*url\s*[^)]*\)/g,
            'pd.read_csv(StringIO(csv_data), sep="\\t", quoting=3, encoding="utf-8")'
          )
          .replace(
            /pd\.read_csv\(\s*["'][^"']*https?:\/\/[^"']+["'][^)]*\)/g,
            'pd.read_csv(StringIO(csv_data), sep="\\t", quoting=3, encoding="utf-8")'
          );

        outputElement.innerHTML = "Data hentet! Kører kode...";

      } catch (error) {
        console.error('Kunne ikke hente URL-data:', error);
        outputElement.innerHTML =
          `<span style="color: orange;">Kunne ikke hente data (${error.message}). Bruger eksempeldata...</span>`;

        // Rigtigt linjeskift, ikke literal backslash-n
        processedCode = FALLBACK_DATA_CODE + "\n" + processedCode
          .replace(/^\s*url\s*=\s*["'][^"']+["'].*$/gm, '')
          .replace(/^\s*df\s*=\s*pd\.read_csv.*$/gm, '# Bruger eksempeldata ovenfor');
      }
    }

    outputElement.textContent = '';

    pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
    `);

    let result;
    try {
      await pyodide.runPythonAsync(processedCode);
    } finally {
      result = pyodide.runPython(`
output = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
output
      `);
    }

    if (result && result.includes('PLOT_HTML:')) {
      const parts = result.split('PLOT_HTML:');
      const textOutput = parts[0].trim();
      const plotHtml = parts.slice(1).join('');

      outputElement.innerHTML = textOutput
        ? `<pre>${textOutput}</pre>${plotHtml}`
        : plotHtml;
    } else {
      outputElement.textContent = result || 'Kode kørt succesfuldt!';
    }

  } catch (error) {
    outputElement.innerHTML = `<span style="color: red;">Fejl: ${error.message}</span>`;
    console.error('Fejl under Python-udførelse:', error);
  }
}

function resetPythonGlobals() {
  if (!pyodideReady) return;

  try {
    pyodide.runPython(`
_keep = {
    'micropip', 'pd', 'pandas', 'np', 'numpy', 'pyfetch', 'StringIO', 'BytesIO',
    'base64', 'sys', 'env_setup', 'plt', 'matplotlib', 'show_plot',
    'analyzer', 'fallback_analyzer', 'SimpleSentimentAnalyzer',
    'SentimentIntensityAnalyzer', 'builtins'
}
for name in list(globals().keys()):
    if not name.startswith('_') and name not in _keep:
        del globals()[name]
    `);

    updateStatus('ready', 'Python-miljø nulstillet');
    console.log('Python-globals nulstillet');
  } catch (error) {
    console.error('Fejl under nulstilling:', error);
    updateStatus('error', 'Fejl ved nulstilling: ' + error.message);
  }
}

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