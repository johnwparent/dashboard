class DefaultDict {
    constructor(factory) {
        return new Proxy({}, {
            get: (target, name) => {
                if (name in target) {
                    return target[name];
                }
                else {
                    target[name] = factory();
                    return target[name];
                }
            }
        });
    }
}

function createDefaultDictFactory(factory) {
    let defaultDictFactory = () => {
        return new DefaultDict(factory);
    }
    return defaultDictFactory;
}

function createMetricFactory() {
    let metricFactory = () => {
        return new Metric();
    }
    return metricFactory;
}

class Metric {
    constructor(
        name = "",
        location = "",
        signature = "",
        cognitive_complexity = 0,
        nesting = 0,
        lines = 0,
        branches = 0,
        statements = 0,
        parameters = 0,
        variables = 0
    ) {
        this.name = name;
        this.location = location;
        this.signature = signature;
        this.cognitive_complexity = cognitive_complexity;
        this.nesting = nesting;
        this.lines = lines;
        this.statements = statements;
        this.branches = branches;
        this.parameters = parameters;
        this.variables = variables;
    }
    print() {
        console.log(`Name: ${this.name}`);
        console.log(`Location: ${this.location}`);
        console.log(`Signature: ${this.signature}`);
        console.log(`Cognitive-Complexity: ${this.cognitive_complexity}`);
    }
}

class MetricParser {
    constructor() {
        this.metricTypes = [
            [/\[readability-function-cognitive-complexity\]$/, 'parseCC'],
            [/\[readability-function-size\]$/, 'parseFS']
        ];
        this.metrics = createDefaultDictFactory(createDefaultDictFactory(createMetricFactory()))();
    }
    extractFunc(line) {
        const funcPattern = /warning: function '(.*)' .*/;
        return funcPattern.exec(line)[1];
    }
    extractFuncAndCC(line) {
        let fName = this.extractFunc(line);
        const ccPattern = /cognitive complexity of (\d+)/
        return [fName, ccPattern.exec(line)[1]]
    }
    extractMethodSig(line) {
        const sigReg = /^\s*\d+\s*\|\s*(.+)$/
        return sigReg.exec(line)[1];
    }
    extractLocation(line) {
        const locReg = /(.*): warning:/;
        return locReg.exec(line)[1];
    }
    extractFilename(line) {
        const fnReg = /^.* (.*)$/;
        let regRes = fnReg.exec(line);
        if (regRes) {
            return regRes[1];
        };
    }
    fileStart(line) {
        const fileStartPattern = /^\[ *\d+\/\d+\]/;
        return fileStartPattern.test(line);
    }
    fileOrMetricStart(line, metric_reg_check) {
        return this.fileStart(line) || metric_reg_check.test(line)
    }
    parseCC(idx, filename) {
        let [func, cc] = this.extractFuncAndCC(this.metric_lines[idx]);
        this.metrics[filename][func].cognitive_complexity = Number(cc);
        let sig = this.extractMethodSig(this.metric_lines[idx+1]);
        let loc = this.extractLocation(this.metric_lines[idx]);
        if(!this.metrics[filename][func].signature) {
            this.metrics[filename][func].signature = sig;
        }
        if(!this.metrics[filename][func].name) {
            this.metrics[filename][func].name = func;
        }
        if(!this.metrics[filename][func].location) {
            this.metrics[filename][func].location = loc;
        }
        const stepReg = /nesting level increased to (\d+)/;
        let nesting_depths = [];
        let off = 2;
        let line = this.metric_lines[idx+off];
        while(idx+off < this.data_size && !this.fileOrMetricStart(line, this.metricTypes[1][0])) {
            off += 1;
            line = this.metric_lines[idx+off];
            let res = stepReg.exec(line);
            if(res) {
                nesting_depths.push(parseInt(res[1]));
            }
        }
        let nesting_depth = Math.max(...nesting_depths);
        this.metrics[filename][func].nesting = nesting_depth
        return off;
    }
    parseFS(idx, filename) {
        let func = this.extractFunc(this.metric_lines[idx]);
        let sig = this.extractMethodSig(this.metric_lines[idx+1]);
        let loc = this.extractLocation(this.metric_lines[idx]);
        if(!this.metrics[filename][func].location) {
            this.metrics[filename][func].location = loc;
        }
        if(!this.metrics[filename][func].signature) {
            this.metrics[filename][func].signature = sig;
        }
        if(!this.metrics[filename][func].name) {
            this.metrics[filename][func].name = func
        }
        let off = 2;
        const fsMetrics = [
            ["lines", /note: (\d+) lines/],
            ["statements", /note: (\d+) statements/],
            ["branches", /note: (\d+) branches/],
            ["variables", /note: (\d+) variables/],
            ["parameters", /note: (\d+) parameters/],
        ];
        let line = this.metric_lines[idx+off];
        while(idx+off < this.data_size && !this.fileOrMetricStart(line, this.metricTypes[0][0])) {
            off += 1;
            line = this.metric_lines[idx+off];
            for(let fsType of fsMetrics) {
                let res = fsType[1].exec(line);
                if (res) {
                    let value = Number(res[1]);
                    let name = fsType[0];
                    this.metrics[filename][func][name] = value;
                    break;
                }
            }
        }
        return off;
    }
    processFile(idx) {
        let filename = this.extractFilename(this.metric_lines[idx]);
        let offset = 1;
        var metric_off = 0;
        while(idx+offset < this.data_size && !this.fileStart(this.metric_lines[idx+offset])) {
            for(let metricType of this.metricTypes) {
                let lineLoc = idx + offset;
                if(metricType[0].test(this.metric_lines[lineLoc])) {
                    metric_off = this[metricType[1]](lineLoc, filename);
                    break;
                };
            };
            offset += (metric_off || 1);
            metric_off = 0;
        };
        return offset;
    }
    parse(data) {
        if (!data) {
            throw Error;
        }
        this.metric_lines = data.split(/\r?\n/);
        this.data_size = this.metric_lines.length;
        for(let i = 0; i < this.data_size; i++) {
            var currLine = this.metric_lines[i];
            if (this.fileStart(currLine)) {
                // We're reading the beginning of clang output for
                // a given file, process this file
                let offset = this.processFile(i);
                i += offset-1;
            };
        };
        // Initial parsing is done, now normalize abs paths to
        // relative
        const lcp = findCommonPath(Object.keys(this.metrics));
        if (lcp && lcp !== '/') {
            for (const file in this.metrics) {
                let new_file = lstrip(file, lcp);
                for (const func in this.metrics[file]) {
                    this.metrics[file][func].location = lstrip(this.metrics[file][func].location, lcp);
                }
                this.metrics[new_file] = this.metrics[file];
                delete this.metrics[file];
            }
        }
    }
    print() {
        for (const file in this.metrics) {
            console.log(`reporting for file: ${file}`);
            for (const func in this.metrics[file]) {
                console.log(`reporting for function: ${func}`);
                this.metrics[file][func].print()
            }
        }
    }
}

function findCommonPath(paths) {
  if (!paths || paths.length === 0) {
    return "";
  }
  let restore_paths = paths[0].includes("\\");
  const splitPaths = paths.map(path => 
    path.replace(/\\/g, '/').split('/')
  );

  let commonComponents = splitPaths[0];

  for (let i = 1; i < splitPaths.length; i++) {
    const currentPath = splitPaths[i];
    let k = 0;

    while (
      k < commonComponents.length &&
      k < currentPath.length &&
      commonComponents[k] === currentPath[k]
    ) {
      k++;
    }

    commonComponents = commonComponents.slice(0, k);

    if (commonComponents.length === 0) {
      return "";
    }
  }

  const result = commonComponents.slice(0,commonComponents.length-1).join('/') + '/';

  if (
    result === '' &&
    commonComponents.length === 1 &&
    commonComponents[0] === ''
  ) {
    return '/';
  }
  if (restore_paths) {
    return result.replace(/\//g, '\\');
  }
  return result;
}

function lstrip(str, charsToRemove) {
  const pattern = new RegExp(`^${charsToRemove}`);
  return str.replace(pattern, '');
}