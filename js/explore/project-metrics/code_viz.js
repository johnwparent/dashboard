
const urlBase = 'https://gitlab.kitware.com/cmake/cmake/-/blob/master/'

var totalScore = 0;
var seenFiles = new Set();
var codeData;
var currCodeData;
var sortOrder = "asc";
let aggregateMetrics = {
    "averageScore": 0,
    "funcCount" : 0,
    "loc" : 0,
    "fileCount" : 0,
    "highestScore" : {
      "value": 0,
      "function" : "",
    },
    "lowestScore": {
      "value": 1000,
      "function" : "",
    },
    "longestFunction": {
      "value": 0,
      "function" : "",
    },
    "branchCount": {
      "value": 0,
      "function" : "",
    },
}

// const data = fs.readFileSync('clang-tidy-metrics.json', 'utf-8');
const cm = document.getElementById('codeMetrics');
// cm.style.width = "1400px";
// cm.style.height = "900px";
const interface = document.createElement('g')
interface.id = "user-interface"

const fi =  document.createElement('input')
fi.type='file'
fi.id = "fileInput";
fi.style.margin = "20px"


fi.addEventListener('change', (event) => {
  const file = event.target.files[0];

    if (file) {
      const reader = new FileReader();

      reader.onload = (e) => {
        const content = e.target.result;
        // Process the file content
        render(content);
      };
      reader.onerror = (e) => {
        console.error("File reading error:", e);
      }
      reader.readAsText(file);
    }
});

interface.appendChild(fi);
cm.appendChild(interface);

const mc = document.createElement('div');
mc.id = "metric-container";
cm.appendChild(mc);


function render(content) {
  codeData = parseMetricJson(JSON.parse(content));
  // maintain mirror of data to manipulate
  currCodeData = Array.from(codeData);
  aggregateMetrics.averageScore = totalScore / codeData.length;
  aggregateMetrics.fileCount = seenFiles.size;
  displayCodeInfo(currCodeData, 'metric-container');
}

function splitAtFirstCapital(str) {
  if (!str) {
    return [];
  }

  const index = str.search(/[A-Z]/);

  if (index === -1 || index === 0) {
    return [str];
  }

  return [str.slice(0, index), str.slice(index)];
}

function displayCodeInfo(codeArray, containerId) {
  // Get the container element where we'll add the code information
  const container = document.getElementById(containerId);

  // Check if the container element exists
  if (!container) {
    console.error(`Container element with ID "${containerId}" not found.`);
    return;
  }
  if (!codeArray) {
    return;
  }
  // Add a baseline metrics box
  const overallMetrics = document.createElement('div');
  overallMetrics.classList.add('box');
  overallMetrics.id = "overallMetrics"
  for (item in aggregateMetrics) {
    // container for each metric
    var metric = document.createElement('div');
    metric.classList.add('code-metric-overview');

    // metric name
    var name = document.createElement('div');
    name.classList.add('overall-metrics-name');
    var readableNameArr = splitAtFirstCapital(item);
    if (readableNameArr.size > 1) {
      var readableName = readableNameArr[0].charAt(0).toUpperCase() + readableNameArr[0].slice(1) + " " + readableNameArr[1];
    }
    else {
      var readableName = readableNameArr[0];
    }
    var nameText = document.createTextNode(readableName);
    name.appendChild(nameText);

    // Metric Value
    var value = document.createElement('div');
    value.classList.add('overall-metrics-value');

    if (typeof aggregateMetrics[item] === 'object') {
      // Function name
      var funcName = document.createElement('div');
      funcName.classList.add('overall-metrics-function-name');
      var funcNameText = document.createTextNode(aggregateMetrics[item].function);
      funcName.appendChild(funcNameText)

      // Ref to rest of functions stats
      var ref = document.createElement('a');
      ref.classList.add('overall-metrics-link')
      ref.href = '#' + aggregateMetrics[item].function + '-metrics';
      ref.appendChild(funcName);

      value.innerHTML = aggregateMetrics[item].value;
    }
    else {
      value.innerHTML = aggregateMetrics[item];
    }

    // Add sub info to metric box
    metric.appendChild(name)
    metric.appendChild(value);
    if (typeof aggregateMetrics[item] === 'object' ) {
      metric.appendChild(ref);
    }
    // add metric box to box of metrics
    overallMetrics.appendChild(metric);
  }
  // Add box of metrics to parent element
  container.appendChild(overallMetrics);

  // Iterate over each item in the metrics
  codeArray.forEach(item => {
    var scoreColor = getColor("#00FF00", "#FF0000", 0, 100, item["cognitive-complexity"]);

    // Create collapsible toggle for each entry
    const codeCollapsible = document.createElement('button');
    codeCollapsible.type = "button";
    codeCollapsible.textContent = item["name"];
    codeCollapsible.style.backgroundColor = scoreColor;
    codeCollapsible.addEventListener("click", function() {
      var content = this.nextElementSibling;
      if (content.style.display === "block") {
        content.style.display = "none";
      } else {
        content.style.display = "block";
      }
    })
    container.appendChild(codeCollapsible);
    // Create a new div element for each entry
    const codeElement = document.createElement('div');
    codeElement.classList.add('code-info-item');
    codeElement.id = item["name"] + "-metrics"
    codeElement.style.display = "none"

    const codeLineElement = document.createElement('pre');
    codeLineElement.textContent = item["code-line"];

    codeLineElement.style.color = scoreColor;
    const codeLineElementRef = document.createElement('a');
    var href = item["location"].split(":").slice(0,1).join("#");
    codeLineElementRef.href = urlBase + href;
    codeLineElementRef.appendChild(codeLineElement);
    codeElement.appendChild(codeLineElementRef);
    const statsElement = document.createElement('ul');
    statsElement.classList.add('code-stats');
    for (const key in item) {
      if (key != "code-line") {
        const listItem = document.createElement('li');
        listItem.textContent = key + ": " + item[key];
        statsElement.appendChild(listItem);
      }
      codeElement.appendChild(statsElement);
    }
    // Append the created code element to the container
    container.appendChild(codeElement);
  });
}

function parseMetricJson(data) {
  var parsedCodeData = [];
  for(var item of data) {
    if ("cognitive-complexity" in item) {
      totalScore += item["cognitive-complexity"];
      aggregateMetrics.funcCount += 1;
      var location = item["location"].split(":")[0];
      seenFiles.add(location);
      aggregateMetrics.loc += item["num-lines"];
      var cogComplexity = item["cognitive-complexity"];
      var numBranches = item["num-branches"];
      var funLen = item["num-statements"];
      // highest score
      if ( cogComplexity > aggregateMetrics.highestScore.value) {
        aggregateMetrics.highestScore.value = cogComplexity;
        aggregateMetrics.highestScore.function = item["name"];
      }
      // lowest score
      if (cogComplexity <aggregateMetrics.lowestScore.value ) {
        aggregateMetrics.lowestScore.value = cogComplexity;
        aggregateMetrics.lowestScore.function = item["name"];
      }
      // longest function
      if (funLen > aggregateMetrics.longestFunction.value) {
        aggregateMetrics.longestFunction.value = funLen;
        aggregateMetrics.longestFunction.function = item["name"];
      }
      // most branches
      if (numBranches > aggregateMetrics.branchCount.value) {
        aggregateMetrics.branchCount.value = numBranches;
        aggregateMetrics.branchCount.function = item["name"];
      }
      parsedCodeData.push(item);
    }
  }
  return parsedCodeData;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function map(value, fromSource, toSource, fromTarget, toTarget) {
  return (value - fromSource) / (toSource - fromSource) * (toTarget - fromTarget) + fromTarget;
}
// inspired by https://stackoverflow.com/a/46543292
function getColor(startcolor, endcolor, min, max, value) {
  var startRGB = hexToRgb(startcolor);
  var endRGB = hexToRgb(endcolor);
  var percentFade = map(value, min, max, 0, 1);

  var diffRed = endRGB.r - startRGB.r;
  var diffGreen = endRGB.g - startRGB.g;
  var diffBlue = endRGB.b - startRGB.b;

  diffRed = (diffRed * percentFade) + startRGB.r;
  diffGreen = (diffGreen * percentFade) + startRGB.g;
  diffBlue = (diffBlue * percentFade) + startRGB.b;

  var result = "rgb(" + Math.round(diffRed) + ", " + Math.round(diffGreen) + ", " + Math.round(diffBlue) + ")";
  return result;
}

function createSortSelector(containerId, sortOptions, onSortChange) {
  const container = document.getElementById(containerId);

  if (!container) {
    console.error(`Container element with ID "${containerId}" not found.`);
    return;
  }

  const label = document.createElement('label');
  label.textContent = 'Sort by: ';
  container.appendChild(label);

  const select = document.createElement('select');
  select.addEventListener('change', (event) => {
    const sortBy = event.target.value;
    onSortChange(sortBy); // Call the provided event handler with the selected value
  });

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select an option';
  select.appendChild(defaultOption);

  for (const key in sortOptions) {
    if (sortOptions.hasOwnProperty(key)) {
      const option = document.createElement('option');
      option.value = sortOptions[key][0];
      option.textContent = sortOptions[key][1];
      select.appendChild(option);
    }
  }

  container.appendChild(select);
}

// Example Usage:
const sortOptions = {
  cogComplexity: ['cognitive-complexity','Cognitive Complexity'],
  numlines: ['num-lines', 'Number of Lines'],
  numstatements: ['num-statements', 'Number of Statements'],
  numbranches: ['num-branches', 'Number of Branches'],
  numparameters: ['num-parameters', 'Number of Parameters'],
  nestinglvl: ['nesting-level', 'Nesting Level'],
  numvariables: ['num-variables', 'Number of Variables']
};

function handleSort(sortByCriteria) {
  document.getElementById('metric-container').innerHTML = '';
  currCodeData = sortArrayOfObjects(currCodeData, sortByCriteria, sortOrder);
  displayCodeInfo(currCodeData, 'metric-container');
}

document.addEventListener('DOMContentLoaded', () => {
  createSortSelector('user-interface', sortOptions, handleSort);
  // Inclusive filter
  addSearchBarWithEnterEvent('user-interface', false);
  // Exclusive filter
  addSearchBarWithEnterEvent('user-interface', true);
  createToggleSwitch('user-interface', 'order-switch', "Ascending/Descending", false, handleOrdering);
});

function sortArrayOfObjects(arr, key, direction = 'asc') {
  if (!Array.isArray(arr)) {
    console.error("Input must be an array.");
    return arr; // Or throw an error
  }

  if (arr.length === 0) {
    return [];
  }

  if (typeof arr[0] !== 'object' || arr[0] === null || !(key in arr[0])) {
    console.error("Array elements must be non-null objects containing the specified key.");
    return arr; // Or throw an error
  }

  const sortedArray = [...arr]; // Create a copy to avoid modifying the original array

  sortedArray.sort((a, b) => {
    const valueA = a[key];
    const valueB = b[key];

    let comparison = 0;

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      comparison = valueA.localeCompare(valueB);
    } else if (typeof valueA === 'number' && typeof valueB === 'number') {
      comparison = valueA - valueB;
    } else if (valueA > valueB) {
      comparison = 1;
    } else if (valueA < valueB) {
      comparison = -1;
    }

    return direction === 'asc' ? comparison : comparison * -1;
  });

  return sortedArray;
}


function filterArrayOfObjects(arr, matcher, reject=false) {
  if (!Array.isArray(arr)) {
    console.error("Error: Input is not an array.");
    return [];
  }
  // Create regular expression to match method names
  if (!matcher) {
    return codeData;
  }
  const re = new RegExp(RegExp.escape(matcher));
  return arr.filter(obj => {
    if(obj["name"].search(re) || obj["code-line"].search(re)) {
      return !reject;
    }
    return reject;
  });
}


function filterExcludeArrayOfObjects(arr, matcher) {
  return filterArrayOfObjects(arr, matcher, true)
}


function handleOrdering(isChecked, switchId) {
    if (isChecked) {
      sortOrder = "asc"
    }
    else {
      sortOrder = "dsc"
    }
    if (currCodeData) {
      currCodeData.reverse();
      document.getElementById('metric-container').innerHTML = '';
      displayCodeInfo(currCodeData, 'metric-container');
    }
}


function createToggleSwitch(parentElementId, switchId, labelText, defaultChecked = false, onChangeCallback = null) {

  // Main container (label for the checkbox, makes the whole thing clickable)
  const switchLabelElement = document.createElement('label');
  switchLabelElement.className = 'js-toggle-switch';
  switchLabelElement.htmlFor = switchId; // Associate label with checkbox

  // Hidden actual checkbox input (handles state and accessibility)
  const checkboxInput = document.createElement('input');
  checkboxInput.type = 'checkbox';
  checkboxInput.id = switchId;
  checkboxInput.name = switchId; // Good practice for form data
  checkboxInput.className = 'js-switch-input';
  checkboxInput.checked = defaultChecked;

  if (onChangeCallback && typeof onChangeCallback === 'function') {
      checkboxInput.addEventListener('change', (event) => {
          onChangeCallback(event.target.checked, event.target.id);
      });
  }

  // Visual part of the switch (the track)
  const sliderElement = document.createElement('span');
  sliderElement.className = 'js-switch-slider';
  // The "knob" of the switch will be created using a CSS pseudo-element (::before) on the slider.

  // Assemble the core switch parts
  switchLabelElement.appendChild(checkboxInput);
  switchLabelElement.appendChild(sliderElement);

  // Optional label text element, displayed next to the switch
  if (labelText && typeof labelText === 'string') {
      const labelTextElement = document.createElement('span');
      labelTextElement.className = 'js-switch-label-text';
      labelTextElement.textContent = labelText;
      switchLabelElement.appendChild(labelTextElement); // Append after the visual switch
  }

  // Append the fully assembled switch to the specified parent element
  var parentElement = document.getElementById(parentElementId);
  parentElement.appendChild(switchLabelElement);

  // Inject CSS for the toggle switch (only once per page load)
  const styleId = 'js-dynamic-toggle-switch-styles';
  if (!document.getElementById(styleId)) {
      const styleSheet = document.createElement('style');
      styleSheet.id = styleId;
      styleSheet.textContent = `
          .js-toggle-switch {
              display: inline-flex; /* Aligns slider and optional text label nicely */
              align-items: center;
              cursor: pointer;
              user-select: none; /* Prevent text selection on click */
              gap: 8px; /* Space between the visual switch and its text label */
              vertical-align: middle; /* Aligns better if mixed with text */
          }
          .js-switch-input {
              /* Hide the default checkbox visually but keep it accessible */
              opacity: 0;
              width: 0;
              height: 0;
              position: absolute; /* Take it out of the layout flow */
          }
          .js-switch-slider {
              position: relative;
              display: inline-block;
              width: 40px;  /* Width of the switch track */
              height: 20px; /* Height of the switch track */
              background-color: #ccc; /* Default color of the track (off state) */
              border-radius: 20px; /* Fully rounded track ends */
              transition: background-color 0.2s ease-in-out;
          }
          /* The Knob for the switch */
          .js-switch-slider::before {
              content: "";
              position: absolute;
              height: 16px; /* Diameter of the knob */
              width: 16px;  /* Diameter of the knob */
              left: 2px;    /* Initial horizontal position of the knob (offset from left) */
              bottom: 2px;  /* Initial vertical position of the knob (offset from bottom) */
              background-color: white;
              border-radius: 50%; /* Perfectly circular knob */
              transition: transform 0.2s ease-in-out;
              box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          }
          /* Styles when the switch is checked (on) */
          .js-switch-input:checked + .js-switch-slider {
              background-color: #4CAF50; /* Active color for the track (e.g., green) */
          }
          .js-switch-input:checked + .js-switch-slider::before {
              /* Move knob to the right: track_width - knob_width - left_offset = 40 - 16 - 2 = 22px (from left edge of slider) */
              /* Or simply slider_width - knob_width - initial_left_offset */
              /* The knob moves by (track_width - (2*offset) - knob_width) = 40 - 4 - 16 = 20px */
              transform: translateX(20px);
          }
          /* Accessibility: Focus styles for keyboard navigation */
          .js-switch-input:focus + .js-switch-slider {
              box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.5); /* Example focus ring, matches active color */
          }
          .js-switch-input:focus:not(:checked) + .js-switch-slider {
                box-shadow: 0 0 0 2px rgba(0,0,0,0.2); /* Focus ring for off state */
          }
          .js-switch-label-text {
              font-size: 1em; /* Adjust as needed */
              color: #333;   /* Text color for the label */
          }
      `;
      document.head.appendChild(styleSheet);
  }
}

function addSearchBarWithEnterEvent(parentElementId, exclusion=false) {
  var filterType = exclusion ? 'exclude' : 'include';
  const placeholderText = `Filter (${filterType})...`;
  const className = 'dynamic-search-bar';
  const elementId = filterType + '-method-filter';

  const searchInput = document.createElement('input');
  searchInput.type = 'search'; // 'search' type can offer built-in clear ('x') button
  searchInput.id = elementId;
  searchInput.className = className;
  searchInput.placeholder = placeholderText;
  searchInput.setAttribute('aria-label', placeholderText);

  searchInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
      const query = searchInput.value.trim();
      if (codeData) {
        filteredCodeData = filterArrayOfObjects(codeData, query, !exclusion);
        currCodeData = filteredCodeData;
        document.getElementById('metric-container').innerHTML = '';
        displayCodeInfo(filteredCodeData, 'metric-container');
      }
    }
  });

  const parentElement = document.getElementById(parentElementId);
  parentElement.appendChild(searchInput);

  const styleId = 'dynamic-search-bar-styles';
  if (!document.getElementById(styleId) && className === 'dynamic-search-bar') {
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = `
        .${className} {
            padding: 10px 15px;
            border: 1px solid #ccc;
            border-radius: 25px; /* More rounded for modern look */
            font-size: 1em;
            margin-top: 5px;
            min-width: 250px; /* Default width */
            box-sizing: border-box; /* Include padding and border in the element's total width and height */
        }
        .${className}:focus {
            outline: none;
            border-color: #007bff; /* Highlight color on focus */
            box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25); /* Focus ring */
        }
    `;
    document.head.appendChild(styleElement);
  }

  return searchInput;
}

function resetFilters(parentElementId) {
  const parentElement = document.getElementById(parentElementId);
  parentElement.innerHTML = ''
  sortOrder = 'asc';
  currCodeData = Array.from(codeData);
  displayCodeInfo(currCodeData, parentElementId);
}

