#!/usr/bin/env node
import { createRequire as __ludionRequire } from "node:module"; const require = __ludionRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "../../node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// ../../node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "../../node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// ../../node_modules/semver/internal/re.js
var require_re = __commonJS({
  "../../node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var safeSrc = exports.safeSrc = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value2) => {
      for (const [token, max] of safeRegexReplacements) {
        value2 = value2.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value2;
    };
    var createToken = (name, value2, isGlobal) => {
      const safe = makeSafeRegex(value2);
      const index = R++;
      debug(name, index, value2);
      t[name] = index;
      src[index] = value2;
      safeSrc[index] = safe;
      re[index] = new RegExp(value2, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// ../../node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "../../node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// ../../node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "../../node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// ../../node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "../../node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var isPrereleaseIdentifier = (prerelease, identifier) => {
      const identifiers = identifier.split(".");
      if (identifiers.length > prerelease.length) {
        return false;
      }
      for (let i = 0; i < identifiers.length; i++) {
        if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) {
          return false;
        }
      }
      return true;
    };
    var SemVer = class _SemVer {
      constructor(version2, options) {
        options = parseOptions(options);
        if (version2 instanceof _SemVer) {
          if (version2.loose === !!options.loose && version2.includePrerelease === !!options.includePrerelease) {
            return version2;
          } else {
            version2 = version2.version;
          }
        } else if (typeof version2 !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version2}".`);
        }
        if (version2.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version2, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version2.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version2}`);
        }
        this.raw = version2;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (isPrereleaseIdentifier(this.prerelease, identifier)) {
                const prereleaseBase = this.prerelease[identifier.split(".").length];
                if (isNaN(prereleaseBase)) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer;
  }
});

// ../../node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "../../node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse = (version2, options, throwErrors = false) => {
      if (version2 instanceof SemVer) {
        return version2;
      }
      try {
        return new SemVer(version2, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse;
  }
});

// ../../node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "../../node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var valid = (version2, options) => {
      const v = parse(version2, options);
      return v ? v.version : null;
    };
    module.exports = valid;
  }
});

// ../../node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "../../node_modules/semver/functions/clean.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var clean = (version2, options) => {
      const s = parse(version2.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// ../../node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "../../node_modules/semver/functions/inc.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var inc = (version2, release, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer(
          version2 instanceof SemVer ? version2.version : version2,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module.exports = inc;
  }
});

// ../../node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "../../node_modules/semver/functions/diff.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse(version1, null, true);
      const v2 = parse(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (lowVersion.compareMain(highVersion) === 0) {
          if (lowVersion.minor && !lowVersion.patch) {
            return "minor";
          }
          return "patch";
        }
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module.exports = diff;
  }
});

// ../../node_modules/semver/functions/major.js
var require_major = __commonJS({
  "../../node_modules/semver/functions/major.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var major = (a, loose) => new SemVer(a, loose).major;
    module.exports = major;
  }
});

// ../../node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "../../node_modules/semver/functions/minor.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var minor = (a, loose) => new SemVer(a, loose).minor;
    module.exports = minor;
  }
});

// ../../node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "../../node_modules/semver/functions/patch.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var patch = (a, loose) => new SemVer(a, loose).patch;
    module.exports = patch;
  }
});

// ../../node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "../../node_modules/semver/functions/prerelease.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var prerelease = (version2, options) => {
      const parsed = parse(version2, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// ../../node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "../../node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compare2 = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare2;
  }
});

// ../../node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "../../node_modules/semver/functions/rcompare.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var rcompare = (a, b, loose) => compare2(b, a, loose);
    module.exports = rcompare;
  }
});

// ../../node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "../../node_modules/semver/functions/compare-loose.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var compareLoose = (a, b) => compare2(a, b, true);
    module.exports = compareLoose;
  }
});

// ../../node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "../../node_modules/semver/functions/compare-build.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer(a, loose);
      const versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// ../../node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "../../node_modules/semver/functions/sort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// ../../node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "../../node_modules/semver/functions/rsort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// ../../node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "../../node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var gt = (a, b, loose) => compare2(a, b, loose) > 0;
    module.exports = gt;
  }
});

// ../../node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "../../node_modules/semver/functions/lt.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var lt = (a, b, loose) => compare2(a, b, loose) < 0;
    module.exports = lt;
  }
});

// ../../node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "../../node_modules/semver/functions/eq.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var eq = (a, b, loose) => compare2(a, b, loose) === 0;
    module.exports = eq;
  }
});

// ../../node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "../../node_modules/semver/functions/neq.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var neq = (a, b, loose) => compare2(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// ../../node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "../../node_modules/semver/functions/gte.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var gte = (a, b, loose) => compare2(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// ../../node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "../../node_modules/semver/functions/lte.js"(exports, module) {
    "use strict";
    var compare2 = require_compare();
    var lte = (a, b, loose) => compare2(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// ../../node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "../../node_modules/semver/functions/cmp.js"(exports, module) {
    "use strict";
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt = require_lt();
    var lte = require_lte();
    var cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp;
  }
});

// ../../node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "../../node_modules/semver/functions/coerce.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version2, options) => {
      if (version2 instanceof SemVer) {
        return version2;
      }
      if (typeof version2 === "number") {
        version2 = String(version2);
      }
      if (typeof version2 !== "string") {
        return null;
      }
      options = options || {};
      let match = null;
      if (!options.rtl) {
        match = version2.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version2)) && (!match || match.index + match[0].length !== version2.length)) {
          if (!match || next.index + next[0].length !== match.index + match[0].length) {
            match = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null) {
        return null;
      }
      const major = match[2];
      const minor = match[3] || "0";
      const patch = match[4] || "0";
      const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
      const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module.exports = coerce;
  }
});

// ../../node_modules/semver/functions/truncate.js
var require_truncate = __commonJS({
  "../../node_modules/semver/functions/truncate.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var constants2 = require_constants();
    var SemVer = require_semver();
    var truncate = (version2, truncation, options) => {
      if (!constants2.RELEASE_TYPES.includes(truncation)) {
        return null;
      }
      const clonedVersion = cloneInputVersion(version2, options);
      return clonedVersion && doTruncation(clonedVersion, truncation);
    };
    var cloneInputVersion = (version2, options) => {
      const versionStringToParse = version2 instanceof SemVer ? version2.version : version2;
      return parse(versionStringToParse, options);
    };
    var doTruncation = (version2, truncation) => {
      if (isPrerelease(truncation)) {
        return version2.version;
      }
      version2.prerelease = [];
      switch (truncation) {
        case "major":
          version2.minor = 0;
          version2.patch = 0;
          break;
        case "minor":
          version2.patch = 0;
          break;
      }
      return version2.format();
    };
    var isPrerelease = (type) => {
      return type.startsWith("pre");
    };
    module.exports = truncate;
  }
});

// ../../node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "../../node_modules/semver/internal/lrucache.js"(exports, module) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value2 = this.map.get(key);
        if (value2 === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value2);
          return value2;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value2) {
        const deleted = this.delete(key);
        if (!deleted && value2 !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value2);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// ../../node_modules/semver/classes/range.js
var require_range = __commonJS({
  "../../node_modules/semver/classes/range.js"(exports, module) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g;
    var Range = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        range = range.replace(BUILDSTRIPRE, "");
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version2) {
        if (!version2) {
          return false;
        }
        if (typeof version2 === "string") {
          try {
            version2 = new SemVer(version2, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version2, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module.exports = Range;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer = require_semver();
    var {
      safeRe: re,
      src,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var BUILDSTRIPRE = new RegExp(src[t.BUILD], "g");
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      comp = comp.replace(re[t.BUILD], "");
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var invalidXRangeOrder = (M, m, p) => isX(M) && !isX(m) || isX(m) && p && !isX(p);
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        if (invalidXRangeOrder(M, m, p)) {
          return comp;
        }
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version2, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version2)) {
          return false;
        }
      }
      if (version2.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version2.major && allowed.minor === version2.minor && allowed.patch === version2.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// ../../node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "../../node_modules/semver/classes/comparator.js"(exports, module) {
    "use strict";
    var ANY = /* @__PURE__ */ Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version2) {
        debug("Comparator.test", version2, this.options.loose);
        if (this.semver === ANY || version2 === ANY) {
          return true;
        }
        if (typeof version2 === "string") {
          try {
            version2 = new SemVer(version2, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp(version2, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp = require_cmp();
    var debug = require_debug();
    var SemVer = require_semver();
    var Range = require_range();
  }
});

// ../../node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "../../node_modules/semver/functions/satisfies.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var satisfies = (version2, range, options) => {
      try {
        range = new Range(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version2);
    };
    module.exports = satisfies;
  }
});

// ../../node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "../../node_modules/semver/ranges/to-comparators.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// ../../node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "../../node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer(max, options);
          }
        }
      });
      return max;
    };
    module.exports = maxSatisfying;
  }
});

// ../../node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "../../node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer(min, options);
          }
        }
      });
      return min;
    };
    module.exports = minSatisfying;
  }
});

// ../../node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "../../node_modules/semver/ranges/min-version.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module.exports = minVersion;
  }
});

// ../../node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "../../node_modules/semver/ranges/valid.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var validRange = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module.exports = validRange;
  }
});

// ../../node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "../../node_modules/semver/ranges/outside.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range = require_range();
    var satisfies = require_satisfies();
    var gt = require_gt();
    var lt = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version2, range, hilo, options) => {
      version2 = new SemVer(version2, options);
      range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies(version2, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version2, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version2, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module.exports = outside;
  }
});

// ../../node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "../../node_modules/semver/ranges/gtr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var gtr = (version2, range, options) => outside(version2, range, ">", options);
    module.exports = gtr;
  }
});

// ../../node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "../../node_modules/semver/ranges/ltr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var ltr = (version2, range, options) => outside(version2, range, "<", options);
    module.exports = ltr;
  }
});

// ../../node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "../../node_modules/semver/ranges/intersects.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range(r1, options);
      r2 = new Range(r2, options);
      return r1.intersects(r2, options);
    };
    module.exports = intersects;
  }
});

// ../../node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "../../node_modules/semver/ranges/simplify.js"(exports, module) {
    "use strict";
    var satisfies = require_satisfies();
    var compare2 = require_compare();
    module.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare2(a, b, options));
      for (const version2 of v) {
        const included = satisfies(version2, range, options);
        if (included) {
          prev = version2;
          if (!first) {
            first = version2;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// ../../node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "../../node_modules/semver/ranges/subset.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies = require_satisfies();
    var compare2 = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range(sub, options);
      dom = new Range(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt = lowerLT(lt, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt) {
        gtltComp = compare2(gt.semver, lt.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies(eq, String(gt), options)) {
          return null;
        }
        if (lt && !satisfies(eq, String(lt), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !c.test(gt.semver)) {
            return false;
          }
        }
        if (lt) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt, c, options);
            if (lower === c && lower !== lt) {
              return false;
            }
          } else if (lt.operator === "<=" && !c.test(lt.semver)) {
            return false;
          }
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt && gtltComp !== 0) {
        return false;
      }
      if (lt && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare2(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare2(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// ../../node_modules/semver/index.js
var require_semver2 = __commonJS({
  "../../node_modules/semver/index.js"(exports, module) {
    "use strict";
    var internalRe = require_re();
    var constants2 = require_constants();
    var SemVer = require_semver();
    var identifiers = require_identifiers();
    var parse = require_parse();
    var valid = require_valid();
    var clean = require_clean();
    var inc = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare2 = require_compare();
    var rcompare = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp = require_cmp();
    var coerce = require_coerce();
    var truncate = require_truncate();
    var Comparator = require_comparator();
    var Range = require_range();
    var satisfies = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module.exports = {
      parse,
      valid,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare: compare2,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      truncate,
      Comparator,
      Range,
      satisfies,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants2.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants2.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// ../../node_modules/@xmldom/xmldom/lib/conventions.js
var require_conventions = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/conventions.js"(exports) {
    "use strict";
    function find(list, predicate, ac) {
      if (ac === void 0) {
        ac = Array.prototype;
      }
      if (list && typeof ac.find === "function") {
        return ac.find.call(list, predicate);
      }
      for (var i = 0; i < list.length; i++) {
        if (hasOwn(list, i)) {
          var item = list[i];
          if (predicate.call(void 0, item, i, list)) {
            return item;
          }
        }
      }
    }
    function freeze(object, oc) {
      if (oc === void 0) {
        oc = Object;
      }
      if (oc && typeof oc.getOwnPropertyDescriptors === "function") {
        object = oc.create(null, oc.getOwnPropertyDescriptors(object));
      }
      return oc && typeof oc.freeze === "function" ? oc.freeze(object) : object;
    }
    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }
    function assign(target, source) {
      if (target === null || typeof target !== "object") {
        throw new TypeError("target is not an object");
      }
      for (var key in source) {
        if (hasOwn(source, key)) {
          target[key] = source[key];
        }
      }
      return target;
    }
    var HTML_BOOLEAN_ATTRIBUTES = freeze({
      allowfullscreen: true,
      async: true,
      autofocus: true,
      autoplay: true,
      checked: true,
      controls: true,
      default: true,
      defer: true,
      disabled: true,
      formnovalidate: true,
      hidden: true,
      ismap: true,
      itemscope: true,
      loop: true,
      multiple: true,
      muted: true,
      nomodule: true,
      novalidate: true,
      open: true,
      playsinline: true,
      readonly: true,
      required: true,
      reversed: true,
      selected: true
    });
    function isHTMLBooleanAttribute(name) {
      return hasOwn(HTML_BOOLEAN_ATTRIBUTES, name.toLowerCase());
    }
    var HTML_VOID_ELEMENTS = freeze({
      area: true,
      base: true,
      br: true,
      col: true,
      embed: true,
      hr: true,
      img: true,
      input: true,
      link: true,
      meta: true,
      param: true,
      source: true,
      track: true,
      wbr: true
    });
    function isHTMLVoidElement(tagName) {
      return hasOwn(HTML_VOID_ELEMENTS, tagName.toLowerCase());
    }
    var HTML_RAW_TEXT_ELEMENTS = freeze({
      script: false,
      style: false,
      textarea: true,
      title: true
    });
    function isHTMLRawTextElement(tagName) {
      var key = tagName.toLowerCase();
      return hasOwn(HTML_RAW_TEXT_ELEMENTS, key) && !HTML_RAW_TEXT_ELEMENTS[key];
    }
    function isHTMLEscapableRawTextElement(tagName) {
      var key = tagName.toLowerCase();
      return hasOwn(HTML_RAW_TEXT_ELEMENTS, key) && HTML_RAW_TEXT_ELEMENTS[key];
    }
    function isHTMLMimeType(mimeType) {
      return mimeType === MIME_TYPE.HTML;
    }
    function hasDefaultHTMLNamespace(mimeType) {
      return isHTMLMimeType(mimeType) || mimeType === MIME_TYPE.XML_XHTML_APPLICATION;
    }
    var MIME_TYPE = freeze({
      /**
       * `text/html`, the only mime type that triggers treating an XML document as HTML.
       *
       * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
       * @see https://en.wikipedia.org/wiki/HTML Wikipedia
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
       * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring
       *      WHATWG HTML Spec
       */
      HTML: "text/html",
      /**
       * `application/xml`, the standard mime type for XML documents.
       *
       * @see https://www.iana.org/assignments/media-types/application/xml IANA MimeType
       *      registration
       * @see https://tools.ietf.org/html/rfc7303#section-9.1 RFC 7303
       * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
       */
      XML_APPLICATION: "application/xml",
      /**
       * `text/xml`, an alias for `application/xml`.
       *
       * @see https://tools.ietf.org/html/rfc7303#section-9.2 RFC 7303
       * @see https://www.iana.org/assignments/media-types/text/xml IANA MimeType registration
       * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
       */
      XML_TEXT: "text/xml",
      /**
       * `application/xhtml+xml`, indicates an XML document that has the default HTML namespace,
       * but is parsed as an XML document.
       *
       * @see https://www.iana.org/assignments/media-types/application/xhtml+xml IANA MimeType
       *      registration
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument WHATWG DOM Spec
       * @see https://en.wikipedia.org/wiki/XHTML Wikipedia
       */
      XML_XHTML_APPLICATION: "application/xhtml+xml",
      /**
       * `image/svg+xml`,
       *
       * @see https://www.iana.org/assignments/media-types/image/svg+xml IANA MimeType registration
       * @see https://www.w3.org/TR/SVG11/ W3C SVG 1.1
       * @see https://en.wikipedia.org/wiki/Scalable_Vector_Graphics Wikipedia
       */
      XML_SVG_IMAGE: "image/svg+xml"
    });
    var _MIME_TYPES = Object.keys(MIME_TYPE).map(function(key) {
      return MIME_TYPE[key];
    });
    function isValidMimeType(mimeType) {
      return _MIME_TYPES.indexOf(mimeType) > -1;
    }
    var NAMESPACE = freeze({
      /**
       * The XHTML namespace.
       *
       * @see http://www.w3.org/1999/xhtml
       */
      HTML: "http://www.w3.org/1999/xhtml",
      /**
       * The SVG namespace.
       *
       * @see http://www.w3.org/2000/svg
       */
      SVG: "http://www.w3.org/2000/svg",
      /**
       * The `xml:` namespace.
       *
       * @see http://www.w3.org/XML/1998/namespace
       */
      XML: "http://www.w3.org/XML/1998/namespace",
      /**
       * The `xmlns:` namespace.
       *
       * @see https://www.w3.org/2000/xmlns/
       */
      XMLNS: "http://www.w3.org/2000/xmlns/"
    });
    exports.assign = assign;
    exports.find = find;
    exports.freeze = freeze;
    exports.HTML_BOOLEAN_ATTRIBUTES = HTML_BOOLEAN_ATTRIBUTES;
    exports.HTML_RAW_TEXT_ELEMENTS = HTML_RAW_TEXT_ELEMENTS;
    exports.HTML_VOID_ELEMENTS = HTML_VOID_ELEMENTS;
    exports.hasDefaultHTMLNamespace = hasDefaultHTMLNamespace;
    exports.hasOwn = hasOwn;
    exports.isHTMLBooleanAttribute = isHTMLBooleanAttribute;
    exports.isHTMLRawTextElement = isHTMLRawTextElement;
    exports.isHTMLEscapableRawTextElement = isHTMLEscapableRawTextElement;
    exports.isHTMLMimeType = isHTMLMimeType;
    exports.isHTMLVoidElement = isHTMLVoidElement;
    exports.isValidMimeType = isValidMimeType;
    exports.MIME_TYPE = MIME_TYPE;
    exports.NAMESPACE = NAMESPACE;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/errors.js
var require_errors = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/errors.js"(exports) {
    "use strict";
    var conventions = require_conventions();
    function extendError(constructor, writableName) {
      constructor.prototype = Object.create(Error.prototype, {
        constructor: { value: constructor },
        name: { value: constructor.name, enumerable: true, writable: writableName }
      });
    }
    var DOMExceptionName = conventions.freeze({
      /**
       * the default value as defined by the spec
       */
      Error: "Error",
      /**
       * @deprecated
       * Use RangeError instead.
       */
      IndexSizeError: "IndexSizeError",
      /**
       * @deprecated
       * Just to match the related static code, not part of the spec.
       */
      DomstringSizeError: "DomstringSizeError",
      HierarchyRequestError: "HierarchyRequestError",
      WrongDocumentError: "WrongDocumentError",
      InvalidCharacterError: "InvalidCharacterError",
      /**
       * @deprecated
       * Just to match the related static code, not part of the spec.
       */
      NoDataAllowedError: "NoDataAllowedError",
      NoModificationAllowedError: "NoModificationAllowedError",
      NotFoundError: "NotFoundError",
      NotSupportedError: "NotSupportedError",
      InUseAttributeError: "InUseAttributeError",
      InvalidStateError: "InvalidStateError",
      SyntaxError: "SyntaxError",
      InvalidModificationError: "InvalidModificationError",
      NamespaceError: "NamespaceError",
      /**
       * @deprecated
       * Use TypeError for invalid arguments,
       * "NotSupportedError" DOMException for unsupported operations,
       * and "NotAllowedError" DOMException for denied requests instead.
       */
      InvalidAccessError: "InvalidAccessError",
      /**
       * @deprecated
       * Just to match the related static code, not part of the spec.
       */
      ValidationError: "ValidationError",
      /**
       * @deprecated
       * Use TypeError instead.
       */
      TypeMismatchError: "TypeMismatchError",
      SecurityError: "SecurityError",
      NetworkError: "NetworkError",
      AbortError: "AbortError",
      /**
       * @deprecated
       * Just to match the related static code, not part of the spec.
       */
      URLMismatchError: "URLMismatchError",
      QuotaExceededError: "QuotaExceededError",
      TimeoutError: "TimeoutError",
      InvalidNodeTypeError: "InvalidNodeTypeError",
      DataCloneError: "DataCloneError",
      EncodingError: "EncodingError",
      NotReadableError: "NotReadableError",
      UnknownError: "UnknownError",
      ConstraintError: "ConstraintError",
      DataError: "DataError",
      TransactionInactiveError: "TransactionInactiveError",
      ReadOnlyError: "ReadOnlyError",
      VersionError: "VersionError",
      OperationError: "OperationError",
      NotAllowedError: "NotAllowedError",
      OptOutError: "OptOutError"
    });
    var DOMExceptionNames = Object.keys(DOMExceptionName);
    function isValidDomExceptionCode(value2) {
      return typeof value2 === "number" && value2 >= 1 && value2 <= 25;
    }
    function endsWithError(value2) {
      return typeof value2 === "string" && value2.substring(value2.length - DOMExceptionName.Error.length) === DOMExceptionName.Error;
    }
    function DOMException(messageOrCode, nameOrMessage) {
      if (isValidDomExceptionCode(messageOrCode)) {
        this.name = DOMExceptionNames[messageOrCode];
        this.message = nameOrMessage || "";
      } else {
        this.message = messageOrCode;
        this.name = endsWithError(nameOrMessage) ? nameOrMessage : DOMExceptionName.Error;
      }
      if (Error.captureStackTrace) Error.captureStackTrace(this, DOMException);
    }
    extendError(DOMException, true);
    Object.defineProperties(DOMException.prototype, {
      code: {
        enumerable: true,
        get: function() {
          var code = DOMExceptionNames.indexOf(this.name);
          if (isValidDomExceptionCode(code)) return code;
          return 0;
        }
      }
    });
    var ExceptionCode = {
      INDEX_SIZE_ERR: 1,
      DOMSTRING_SIZE_ERR: 2,
      HIERARCHY_REQUEST_ERR: 3,
      WRONG_DOCUMENT_ERR: 4,
      INVALID_CHARACTER_ERR: 5,
      NO_DATA_ALLOWED_ERR: 6,
      NO_MODIFICATION_ALLOWED_ERR: 7,
      NOT_FOUND_ERR: 8,
      NOT_SUPPORTED_ERR: 9,
      INUSE_ATTRIBUTE_ERR: 10,
      INVALID_STATE_ERR: 11,
      SYNTAX_ERR: 12,
      INVALID_MODIFICATION_ERR: 13,
      NAMESPACE_ERR: 14,
      INVALID_ACCESS_ERR: 15,
      VALIDATION_ERR: 16,
      TYPE_MISMATCH_ERR: 17,
      SECURITY_ERR: 18,
      NETWORK_ERR: 19,
      ABORT_ERR: 20,
      URL_MISMATCH_ERR: 21,
      QUOTA_EXCEEDED_ERR: 22,
      TIMEOUT_ERR: 23,
      INVALID_NODE_TYPE_ERR: 24,
      DATA_CLONE_ERR: 25
    };
    var entries = Object.entries(ExceptionCode);
    for (i = 0; i < entries.length; i++) {
      key = entries[i][0];
      DOMException[key] = entries[i][1];
    }
    var key;
    var i;
    function ParseError(message, locator, cause) {
      this.message = message;
      this.locator = locator;
      this.cause = cause;
      if (Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
    }
    extendError(ParseError);
    exports.DOMException = DOMException;
    exports.DOMExceptionName = DOMExceptionName;
    exports.ExceptionCode = ExceptionCode;
    exports.ParseError = ParseError;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/grammar.js
var require_grammar = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/grammar.js"(exports) {
    "use strict";
    function detectUnicodeSupport(RegExpImpl) {
      try {
        if (typeof RegExpImpl !== "function") {
          RegExpImpl = RegExp;
        }
        var match = new RegExpImpl("\u{1D306}", "u").exec("\u{1D306}");
        return !!match && match[0].length === 2;
      } catch (error) {
      }
      return false;
    }
    var UNICODE_SUPPORT = detectUnicodeSupport();
    function chars(regexp) {
      if (regexp.source[0] !== "[") {
        throw new Error(regexp + " can not be used with chars");
      }
      return regexp.source.slice(1, regexp.source.lastIndexOf("]"));
    }
    function chars_without(regexp, search) {
      if (regexp.source[0] !== "[") {
        throw new Error("/" + regexp.source + "/ can not be used with chars_without");
      }
      if (!search || typeof search !== "string") {
        throw new Error(JSON.stringify(search) + " is not a valid search");
      }
      if (regexp.source.indexOf(search) === -1) {
        throw new Error('"' + search + '" is not is /' + regexp.source + "/");
      }
      if (search === "-" && regexp.source.indexOf(search) !== 1) {
        throw new Error('"' + search + '" is not at the first postion of /' + regexp.source + "/");
      }
      return new RegExp(regexp.source.replace(search, ""), UNICODE_SUPPORT ? "u" : "");
    }
    function reg(args) {
      var self = this;
      return new RegExp(
        Array.prototype.slice.call(arguments).map(function(part) {
          var isStr = typeof part === "string";
          if (isStr && self === void 0 && part === "|") {
            throw new Error("use regg instead of reg to wrap expressions with `|`!");
          }
          return isStr ? part : part.source;
        }).join(""),
        UNICODE_SUPPORT ? "u" : ""
      );
    }
    function regg(args) {
      if (arguments.length === 0) {
        throw new Error("no parameters provided");
      }
      return reg.apply(regg, ["(?:"].concat(Array.prototype.slice.call(arguments), [")"]));
    }
    var UNICODE_REPLACEMENT_CHARACTER = "\uFFFD";
    var Char = /[-\x09\x0A\x0D\x20-\x2C\x2E-\uD7FF\uE000-\uFFFD]/;
    if (UNICODE_SUPPORT) {
      Char = reg("[", chars(Char), "\\u{10000}-\\u{10FFFF}", "]");
    }
    var InvalidChar = new RegExp("[^" + chars(Char) + "]", UNICODE_SUPPORT ? "u" : "");
    var _SChar = /[\x20\x09\x0D\x0A]/;
    var SChar_s = chars(_SChar);
    var S = reg(_SChar, "+");
    var S_OPT = reg(_SChar, "*");
    var NameStartChar = /[:_a-zA-Z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
    if (UNICODE_SUPPORT) {
      NameStartChar = reg("[", chars(NameStartChar), "\\u{10000}-\\u{10FFFF}", "]");
    }
    var NameStartChar_s = chars(NameStartChar);
    var NameChar = reg("[", NameStartChar_s, chars(/[-.0-9\xB7]/), chars(/[\u0300-\u036F\u203F-\u2040]/), "]");
    var Name = reg(NameStartChar, NameChar, "*");
    var Name_exact = reg("^", Name, "$");
    var Nmtoken = reg(NameChar, "+");
    var EntityRef = reg("&", Name, ";");
    var CharRef = regg(/&#[0-9]+;|&#x[0-9a-fA-F]+;/);
    var Reference = regg(EntityRef, "|", CharRef);
    var PEReference = reg("%", Name, ";");
    var EntityValue = regg(
      reg('"', regg(/[^%&"]/, "|", PEReference, "|", Reference), "*", '"'),
      "|",
      reg("'", regg(/[^%&']/, "|", PEReference, "|", Reference), "*", "'")
    );
    var AttValue = regg('"', regg(/[^<&"]/, "|", Reference), "*", '"', "|", "'", regg(/[^<&']/, "|", Reference), "*", "'");
    var NCNameStartChar = chars_without(NameStartChar, ":");
    var NCNameChar = chars_without(NameChar, ":");
    var NCName = reg(NCNameStartChar, NCNameChar, "*");
    var NCName_exact = reg("^", NCName, "$");
    var QName = reg(NCName, regg(":", NCName), "?");
    var QName_exact = reg("^", QName, "$");
    var QName_group = reg("(", QName, ")");
    var SystemLiteral = regg(/"[^"]*"|'[^']*'/);
    var PI = reg(/^<\?/, "(", Name, ")", regg(S, "(?!", _SChar, ")(", Char, "*?)"), "?", /\?>/);
    var PubidChar = /[\x20\x0D\x0Aa-zA-Z0-9-'()+,./:=?;!*#@$_%]/;
    var PubidLiteral = regg('"', PubidChar, '*"', "|", "'", chars_without(PubidChar, "'"), "*'");
    var COMMENT_START = "<!--";
    var COMMENT_END = "-->";
    var Comment = reg(COMMENT_START, regg(chars_without(Char, "-"), "|", reg("-", chars_without(Char, "-"))), "*", COMMENT_END);
    var PCDATA = "#PCDATA";
    var Mixed = regg(
      reg(/\(/, S_OPT, PCDATA, regg(S_OPT, /\|/, S_OPT, QName), "*", S_OPT, /\)\*/),
      "|",
      reg(/\(/, S_OPT, PCDATA, S_OPT, /\)/)
    );
    var _children_quantity = /[?*+]?/;
    var children2 = reg(
      /\([^>]+\)/,
      _children_quantity
      /*regg(choice, '|', seq), _children_quantity*/
    );
    var contentspec = regg("EMPTY", "|", "ANY", "|", Mixed, "|", children2);
    var ELEMENTDECL_START = "<!ELEMENT";
    var elementdecl = reg(ELEMENTDECL_START, S, regg(QName, "|", PEReference), S, regg(contentspec, "|", PEReference), S_OPT, ">");
    var NotationType = reg("NOTATION", S, /\(/, S_OPT, Name, regg(S_OPT, /\|/, S_OPT, Name), "*", S_OPT, /\)/);
    var Enumeration = reg(/\(/, S_OPT, Nmtoken, regg(S_OPT, /\|/, S_OPT, Nmtoken), "*", S_OPT, /\)/);
    var EnumeratedType = regg(NotationType, "|", Enumeration);
    var AttType = regg(/CDATA|ID|IDREF|IDREFS|ENTITY|ENTITIES|NMTOKEN|NMTOKENS/, "|", EnumeratedType);
    var DefaultDecl = regg(/#REQUIRED|#IMPLIED/, "|", regg(regg("#FIXED", S), "?", AttValue));
    var AttDef = regg(S, Name, S, AttType, S, DefaultDecl);
    var ATTLIST_DECL_START = "<!ATTLIST";
    var AttlistDecl = reg(ATTLIST_DECL_START, S, Name, AttDef, "*", S_OPT, ">");
    var ABOUT_LEGACY_COMPAT = "about:legacy-compat";
    var ABOUT_LEGACY_COMPAT_SystemLiteral = regg('"' + ABOUT_LEGACY_COMPAT + '"', "|", "'" + ABOUT_LEGACY_COMPAT + "'");
    var SYSTEM = "SYSTEM";
    var PUBLIC = "PUBLIC";
    var ExternalID = regg(regg(SYSTEM, S, SystemLiteral), "|", regg(PUBLIC, S, PubidLiteral, S, SystemLiteral));
    var ExternalID_match = reg(
      "^",
      regg(
        regg(SYSTEM, S, "(?<SystemLiteralOnly>", SystemLiteral, ")"),
        "|",
        regg(PUBLIC, S, "(?<PubidLiteral>", PubidLiteral, ")", S, "(?<SystemLiteral>", SystemLiteral, ")")
      )
    );
    var PubidLiteral_match = reg("^", PubidLiteral, "$");
    var SystemLiteral_match = reg("^", SystemLiteral, "$");
    var NDataDecl = regg(S, "NDATA", S, Name);
    var EntityDef = regg(EntityValue, "|", regg(ExternalID, NDataDecl, "?"));
    var ENTITY_DECL_START = "<!ENTITY";
    var GEDecl = reg(ENTITY_DECL_START, S, Name, S, EntityDef, S_OPT, ">");
    var PEDef = regg(EntityValue, "|", ExternalID);
    var PEDecl = reg(ENTITY_DECL_START, S, "%", S, Name, S, PEDef, S_OPT, ">");
    var EntityDecl = regg(GEDecl, "|", PEDecl);
    var PublicID = reg(PUBLIC, S, PubidLiteral);
    var NotationDecl = reg("<!NOTATION", S, Name, S, regg(ExternalID, "|", PublicID), S_OPT, ">");
    var Eq = reg(S_OPT, "=", S_OPT);
    var VersionNum = /1[.]\d+/;
    var VersionInfo = reg(S, "version", Eq, regg("'", VersionNum, "'", "|", '"', VersionNum, '"'));
    var EncName = /[A-Za-z][-A-Za-z0-9._]*/;
    var EncodingDecl = regg(S, "encoding", Eq, regg('"', EncName, '"', "|", "'", EncName, "'"));
    var SDDecl = regg(S, "standalone", Eq, regg("'", regg("yes", "|", "no"), "'", "|", '"', regg("yes", "|", "no"), '"'));
    var XMLDecl = reg(/^<\?xml/, VersionInfo, EncodingDecl, "?", SDDecl, "?", S_OPT, /\?>/);
    var DOCTYPE_DECL_START = "<!DOCTYPE";
    var CDATA_START = "<![CDATA[";
    var CDATA_END = "]]>";
    var CDStart = /<!\[CDATA\[/;
    var CDEnd = /\]\]>/;
    var CData = reg(Char, "*?", CDEnd);
    var CDSect = reg(CDStart, CData);
    exports.chars = chars;
    exports.chars_without = chars_without;
    exports.detectUnicodeSupport = detectUnicodeSupport;
    exports.reg = reg;
    exports.regg = regg;
    exports.ABOUT_LEGACY_COMPAT = ABOUT_LEGACY_COMPAT;
    exports.ABOUT_LEGACY_COMPAT_SystemLiteral = ABOUT_LEGACY_COMPAT_SystemLiteral;
    exports.AttlistDecl = AttlistDecl;
    exports.CDATA_START = CDATA_START;
    exports.CDATA_END = CDATA_END;
    exports.CDSect = CDSect;
    exports.Char = Char;
    exports.Comment = Comment;
    exports.COMMENT_START = COMMENT_START;
    exports.COMMENT_END = COMMENT_END;
    exports.DOCTYPE_DECL_START = DOCTYPE_DECL_START;
    exports.elementdecl = elementdecl;
    exports.EntityDecl = EntityDecl;
    exports.EntityValue = EntityValue;
    exports.ExternalID = ExternalID;
    exports.ExternalID_match = ExternalID_match;
    exports.Name = Name;
    exports.Name_exact = Name_exact;
    exports.NCName_exact = NCName_exact;
    exports.NotationDecl = NotationDecl;
    exports.Reference = Reference;
    exports.PEReference = PEReference;
    exports.PI = PI;
    exports.PUBLIC = PUBLIC;
    exports.PubidLiteral = PubidLiteral;
    exports.PubidLiteral_match = PubidLiteral_match;
    exports.QName = QName;
    exports.QName_exact = QName_exact;
    exports.QName_group = QName_group;
    exports.S = S;
    exports.SChar_s = SChar_s;
    exports.S_OPT = S_OPT;
    exports.SYSTEM = SYSTEM;
    exports.SystemLiteral = SystemLiteral;
    exports.SystemLiteral_match = SystemLiteral_match;
    exports.InvalidChar = InvalidChar;
    exports.UNICODE_REPLACEMENT_CHARACTER = UNICODE_REPLACEMENT_CHARACTER;
    exports.UNICODE_SUPPORT = UNICODE_SUPPORT;
    exports.XMLDecl = XMLDecl;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/dom.js
var require_dom = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/dom.js"(exports) {
    "use strict";
    var conventions = require_conventions();
    var find = conventions.find;
    var hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
    var hasOwn = conventions.hasOwn;
    var isHTMLMimeType = conventions.isHTMLMimeType;
    var isHTMLRawTextElement = conventions.isHTMLRawTextElement;
    var isHTMLVoidElement = conventions.isHTMLVoidElement;
    var MIME_TYPE = conventions.MIME_TYPE;
    var NAMESPACE = conventions.NAMESPACE;
    var PDC = /* @__PURE__ */ Symbol();
    var errors = require_errors();
    var DOMException = errors.DOMException;
    var DOMExceptionName = errors.DOMExceptionName;
    var g = require_grammar();
    function checkSymbol(symbol) {
      if (symbol !== PDC) {
        throw new TypeError("Illegal constructor");
      }
    }
    function notEmptyString(input) {
      return input !== "";
    }
    function splitOnASCIIWhitespace(input) {
      return input ? input.split(/[\t\n\f\r ]+/).filter(notEmptyString) : [];
    }
    function orderedSetReducer(current, element) {
      if (!hasOwn(current, element)) {
        current[element] = true;
      }
      return current;
    }
    function toOrderedSet(input) {
      if (!input) return [];
      var list = splitOnASCIIWhitespace(input);
      return Object.keys(list.reduce(orderedSetReducer, {}));
    }
    function arrayIncludes(list) {
      return function(element) {
        return list && list.indexOf(element) !== -1;
      };
    }
    function validateQualifiedName(qualifiedName) {
      if (!g.QName_exact.test(qualifiedName)) {
        throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'invalid character in qualified name "' + qualifiedName + '"');
      }
    }
    function validateAndExtract(namespace, qualifiedName) {
      validateQualifiedName(qualifiedName);
      namespace = namespace || null;
      var prefix = null;
      var localName = qualifiedName;
      if (qualifiedName.indexOf(":") >= 0) {
        var splitResult = qualifiedName.split(":");
        prefix = splitResult[0];
        localName = splitResult[1];
      }
      if (prefix !== null && namespace === null) {
        throw new DOMException(DOMException.NAMESPACE_ERR, "prefix is non-null and namespace is null");
      }
      if (prefix === "xml" && namespace !== conventions.NAMESPACE.XML) {
        throw new DOMException(DOMException.NAMESPACE_ERR, 'prefix is "xml" and namespace is not the XML namespace');
      }
      if ((prefix === "xmlns" || qualifiedName === "xmlns") && namespace !== conventions.NAMESPACE.XMLNS) {
        throw new DOMException(
          DOMException.NAMESPACE_ERR,
          'either qualifiedName or prefix is "xmlns" and namespace is not the XMLNS namespace'
        );
      }
      if (namespace === conventions.NAMESPACE.XMLNS && prefix !== "xmlns" && qualifiedName !== "xmlns") {
        throw new DOMException(
          DOMException.NAMESPACE_ERR,
          'namespace is the XMLNS namespace and neither qualifiedName nor prefix is "xmlns"'
        );
      }
      return [namespace, prefix, localName];
    }
    function copy(src, dest) {
      for (var p in src) {
        if (hasOwn(src, p)) {
          dest[p] = src[p];
        }
      }
    }
    function _extends(Class, Super) {
      var pt = Class.prototype;
      if (!(pt instanceof Super)) {
        let t = function() {
        };
        t.prototype = Super.prototype;
        t = new t();
        copy(pt, t);
        Class.prototype = pt = t;
      }
      if (pt.constructor != Class) {
        if (typeof Class != "function") {
          console.error("unknown Class:" + Class);
        }
        pt.constructor = Class;
      }
    }
    var NodeType = {};
    var ELEMENT_NODE = NodeType.ELEMENT_NODE = 1;
    var ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE = 2;
    var TEXT_NODE = NodeType.TEXT_NODE = 3;
    var CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE = 4;
    var ENTITY_REFERENCE_NODE = NodeType.ENTITY_REFERENCE_NODE = 5;
    var ENTITY_NODE = NodeType.ENTITY_NODE = 6;
    var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
    var COMMENT_NODE = NodeType.COMMENT_NODE = 8;
    var DOCUMENT_NODE = NodeType.DOCUMENT_NODE = 9;
    var DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE = 10;
    var DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE = 11;
    var NOTATION_NODE = NodeType.NOTATION_NODE = 12;
    var DocumentPosition = conventions.freeze({
      DOCUMENT_POSITION_DISCONNECTED: 1,
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_CONTAINS: 8,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
      DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32
    });
    function commonAncestor(a, b) {
      if (b.length < a.length) return commonAncestor(b, a);
      var c = null;
      for (var n in a) {
        if (a[n] !== b[n]) return c;
        c = a[n];
      }
      return c;
    }
    function docGUID(doc) {
      if (!doc.guid) doc.guid = Math.random();
      return doc.guid;
    }
    function NodeList() {
    }
    NodeList.prototype = {
      /**
       * The number of nodes in the list. The range of valid child node indices is 0 to length-1
       * inclusive.
       *
       * @type {number}
       */
      length: 0,
      /**
       * Returns the item at `index`. If index is greater than or equal to the number of nodes in
       * the list, this returns null.
       *
       * @param index
       * Unsigned long Index into the collection.
       * @returns {Node | null}
       * The node at position `index` in the NodeList,
       * or null if that is not a valid index.
       */
      item: function(index) {
        return index >= 0 && index < this.length ? this[index] : null;
      },
      /**
       * Returns a string representation of the NodeList.
       *
       * Accepts the same `options` object as `XMLSerializer.prototype.serializeToString`
       * (`requireWellFormed`, `splitCDATASections`, `nodeFilter`). Passing a function is treated as
       * a legacy `nodeFilter` for backward compatibility.
       *
       * @param {Object | function} [options]
       * @param {boolean} [options.requireWellFormed=false]
       * @param {boolean} [options.splitCDATASections=true]
       * @param {function} [options.nodeFilter]
       * @returns {string}
       */
      toString: function(options) {
        var opts;
        if (typeof options === "function") {
          opts = { requireWellFormed: false, splitCDATASections: true, nodeFilter: options };
        } else if (!!options) {
          opts = {
            requireWellFormed: !!options.requireWellFormed,
            splitCDATASections: options.splitCDATASections !== false,
            nodeFilter: options.nodeFilter || null
          };
        } else {
          opts = { requireWellFormed: false, splitCDATASections: true, nodeFilter: null };
        }
        for (var buf = [], i = 0; i < this.length; i++) {
          serializeToString(this[i], buf, null, opts);
        }
        return buf.join("");
      },
      /**
       * Filters the NodeList based on a predicate.
       *
       * @param {function(Node): boolean} predicate
       * - A predicate function to filter the NodeList.
       * @returns {Node[]}
       * An array of nodes that satisfy the predicate.
       * @private
       */
      filter: function(predicate) {
        return Array.prototype.filter.call(this, predicate);
      },
      /**
       * Returns the first index at which a given node can be found in the NodeList, or -1 if it is
       * not present.
       *
       * @param {Node} item
       * - The Node item to locate in the NodeList.
       * @returns {number}
       * The first index of the node in the NodeList; -1 if not found.
       * @private
       */
      indexOf: function(item) {
        return Array.prototype.indexOf.call(this, item);
      }
    };
    NodeList.prototype[Symbol.iterator] = function() {
      var me = this;
      var index = 0;
      return {
        next: function() {
          if (index < me.length) {
            return {
              value: me[index++],
              done: false
            };
          } else {
            return {
              done: true
            };
          }
        },
        return: function() {
          return {
            done: true
          };
        }
      };
    };
    function LiveNodeList(node, refresh) {
      this._node = node;
      this._refresh = refresh;
      _updateLiveList(this);
    }
    function _updateLiveList(list) {
      var inc = list._node._inc || list._node.ownerDocument._inc;
      if (list._inc !== inc) {
        var ls = list._refresh(list._node);
        __set__(list, "length", ls.length);
        if (!list.$$length || ls.length < list.$$length) {
          for (var i = ls.length; i in list; i++) {
            if (hasOwn(list, i)) {
              delete list[i];
            }
          }
        }
        copy(ls, list);
        list._inc = inc;
      }
    }
    LiveNodeList.prototype.item = function(i) {
      _updateLiveList(this);
      return this[i] || null;
    };
    _extends(LiveNodeList, NodeList);
    function NamedNodeMap() {
      this._nsIndex = /* @__PURE__ */ Object.create(null);
      this._noNsIndex = /* @__PURE__ */ Object.create(null);
    }
    function _findNodeIndex(list, node) {
      var i = 0;
      while (i < list.length) {
        if (list[i] === node) {
          return i;
        }
        i++;
      }
    }
    function _nnmBucket(map, namespaceURI, create) {
      if (!namespaceURI) {
        return map._noNsIndex;
      }
      var bucket = map._nsIndex[namespaceURI];
      if (!bucket && create) {
        bucket = map._nsIndex[namespaceURI] = /* @__PURE__ */ Object.create(null);
      }
      return bucket;
    }
    function _nnmIndexFind(map, namespaceURI, localName) {
      var bucket = _nnmBucket(map, namespaceURI, false);
      var found = bucket && bucket[localName];
      return found ? found : null;
    }
    function _nnmIndexAdd(map, attr) {
      _nnmBucket(map, attr.namespaceURI, true)[attr.localName] = attr;
    }
    function _nnmIndexRemove(map, attr) {
      var bucket = _nnmBucket(map, attr.namespaceURI, false);
      if (bucket) {
        delete bucket[attr.localName];
      }
    }
    function _addNamedNode(el, list, newAttr, oldAttr) {
      if (oldAttr) {
        list[_findNodeIndex(list, oldAttr)] = newAttr;
      } else {
        list[list.length] = newAttr;
        list.length++;
      }
      _nnmIndexAdd(list, newAttr);
      if (el) {
        newAttr.ownerElement = el;
        var doc = el.ownerDocument;
        if (doc) {
          oldAttr && _onRemoveAttribute(doc, el, oldAttr);
          _onAddAttribute(doc, el, newAttr);
        }
      }
    }
    function _removeNamedNode(el, list, attr) {
      var i = _findNodeIndex(list, attr);
      if (i >= 0) {
        var lastIndex = list.length - 1;
        while (i <= lastIndex) {
          list[i] = list[++i];
        }
        list.length = lastIndex;
        _nnmIndexRemove(list, attr);
        if (el) {
          var doc = el.ownerDocument;
          if (doc) {
            _onRemoveAttribute(doc, el, attr);
          }
          attr.ownerElement = null;
        }
      }
    }
    NamedNodeMap.prototype = {
      length: 0,
      item: NodeList.prototype.item,
      /**
       * Get an attribute by name. Note: Name is in lower case in case of HTML namespace and
       * document.
       *
       * @param {string} localName
       * The local name of the attribute.
       * @returns {Attr | null}
       * The attribute with the given local name, or null if no such attribute exists.
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-get-by-name
       */
      getNamedItem: function(localName) {
        if (this._ownerElement && this._ownerElement._isInHTMLDocumentAndNamespace()) {
          localName = localName.toLowerCase();
        }
        var i = 0;
        while (i < this.length) {
          var attr = this[i];
          if (attr.nodeName === localName) {
            return attr;
          }
          i++;
        }
        return null;
      },
      /**
       * Set an attribute.
       *
       * @param {Attr} attr
       * The attribute to set.
       * @returns {Attr | null}
       * The old attribute with the same local name and namespace URI as the new one, or null if no
       * such attribute exists.
       * @throws {DOMException}
       * With code:
       * - {@link INUSE_ATTRIBUTE_ERR} - If the attribute is already an attribute of another
       * element.
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-set
       */
      setNamedItem: function(attr) {
        var el = attr.ownerElement;
        if (el && el !== this._ownerElement) {
          throw new DOMException(DOMException.INUSE_ATTRIBUTE_ERR);
        }
        var oldAttr = _nnmIndexFind(this, attr.namespaceURI, attr.localName);
        if (oldAttr === attr) {
          return attr;
        }
        _addNamedNode(this._ownerElement, this, attr, oldAttr);
        return oldAttr;
      },
      /**
       * Set an attribute, replacing an existing attribute with the same local name and namespace
       * URI if one exists.
       *
       * @param {Attr} attr
       * The attribute to set.
       * @returns {Attr | null}
       * The old attribute with the same local name and namespace URI as the new one, or null if no
       * such attribute exists.
       * @throws {DOMException}
       * Throws a DOMException with the name "InUseAttributeError" if the attribute is already an
       * attribute of another element.
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-set
       */
      setNamedItemNS: function(attr) {
        return this.setNamedItem(attr);
      },
      /**
       * Removes an attribute specified by the local name.
       *
       * @param {string} localName
       * The local name of the attribute to be removed.
       * @returns {Attr}
       * The attribute node that was removed.
       * @throws {DOMException}
       * With code:
       * - {@link DOMException.NOT_FOUND_ERR} if no attribute with the given name is found.
       * @see https://dom.spec.whatwg.org/#dom-namednodemap-removenameditem
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-remove-by-name
       */
      removeNamedItem: function(localName) {
        var attr = this.getNamedItem(localName);
        if (!attr) {
          throw new DOMException(DOMException.NOT_FOUND_ERR, localName);
        }
        _removeNamedNode(this._ownerElement, this, attr);
        return attr;
      },
      /**
       * Removes an attribute specified by the namespace and local name.
       *
       * @param {string | null} namespaceURI
       * The namespace URI of the attribute to be removed.
       * @param {string} localName
       * The local name of the attribute to be removed.
       * @returns {Attr}
       * The attribute node that was removed.
       * @throws {DOMException}
       * With code:
       * - {@link DOMException.NOT_FOUND_ERR} if no attribute with the given namespace URI and local
       * name is found.
       * @see https://dom.spec.whatwg.org/#dom-namednodemap-removenameditemns
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-remove-by-namespace
       */
      removeNamedItemNS: function(namespaceURI, localName) {
        var attr = this.getNamedItemNS(namespaceURI, localName);
        if (!attr) {
          throw new DOMException(DOMException.NOT_FOUND_ERR, namespaceURI ? namespaceURI + " : " + localName : localName);
        }
        _removeNamedNode(this._ownerElement, this, attr);
        return attr;
      },
      /**
       * Get an attribute by namespace and local name.
       *
       * @param {string | null} namespaceURI
       * The namespace URI of the attribute.
       * @param {string} localName
       * The local name of the attribute.
       * @returns {Attr | null}
       * The attribute with the given namespace URI and local name, or null if no such attribute
       * exists.
       * @see https://dom.spec.whatwg.org/#concept-element-attributes-get-by-namespace
       */
      getNamedItemNS: function(namespaceURI, localName) {
        if (!namespaceURI) {
          namespaceURI = null;
        }
        var i = 0;
        while (i < this.length) {
          var node = this[i];
          if (node.localName === localName && node.namespaceURI === namespaceURI) {
            return node;
          }
          i++;
        }
        return null;
      }
    };
    NamedNodeMap.prototype[Symbol.iterator] = function() {
      var me = this;
      var index = 0;
      return {
        next: function() {
          if (index < me.length) {
            return {
              value: me[index++],
              done: false
            };
          } else {
            return {
              done: true
            };
          }
        },
        return: function() {
          return {
            done: true
          };
        }
      };
    };
    function DOMImplementation() {
    }
    DOMImplementation.prototype = {
      /**
       * Test if the DOM implementation implements a specific feature and version, as specified in
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/core.html#DOMFeatures DOM Features}.
       *
       * The DOMImplementation.hasFeature() method returns a Boolean flag indicating if a given
       * feature is supported. The different implementations fairly diverged in what kind of
       * features were reported. The latest version of the spec settled to force this method to
       * always return true, where the functionality was accurate and in use.
       *
       * @deprecated
       * It is deprecated and modern browsers return true in all cases.
       * @function DOMImplementation#hasFeature
       * @param {string} feature
       * The name of the feature to test.
       * @param {string} [version]
       * This is the version number of the feature to test.
       * @returns {boolean}
       * Always returns true.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/hasFeature MDN
       * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-5CED94D7 DOM Level 1 Core
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature DOM Living Standard
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-5CED94D7 DOM Level 3 Core
       */
      hasFeature: function(feature, version2) {
        return true;
      },
      /**
       * Creates a DOM Document object of the specified type with its document element. Note that
       * based on the {@link DocumentType}
       * given to create the document, the implementation may instantiate specialized
       * {@link Document} objects that support additional features than the "Core", such as "HTML"
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#DOM2HTML DOM Level 2 HTML}.
       * On the other hand, setting the {@link DocumentType} after the document was created makes
       * this very unlikely to happen. Alternatively, specialized {@link Document} creation methods,
       * such as createHTMLDocument
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#DOM2HTML DOM Level 2 HTML},
       * can be used to obtain specific types of {@link Document} objects.
       *
       * __It behaves slightly different from the description in the living standard__:
       * - There is no interface/class `XMLDocument`, it returns a `Document`
       * instance (with it's `type` set to `'xml'`).
       * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
       *
       * @function DOMImplementation.createDocument
       * @param {string | null} namespaceURI
       * The
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-namespaceURI namespace URI}
       * of the document element to create or null.
       * @param {string | null} qualifiedName
       * The
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-qualifiedname qualified name}
       * of the document element to be created or null.
       * @param {DocumentType | null} [doctype=null]
       * The type of document to be created or null. When doctype is not null, its
       * {@link Node#ownerDocument} attribute is set to the document being created. Default is
       * `null`
       * @returns {Document}
       * A new {@link Document} object with its document element. If the NamespaceURI,
       * qualifiedName, and doctype are null, the returned {@link Document} is empty with no
       * document element.
       * @throws {DOMException}
       * With code:
       *
       * - `INVALID_CHARACTER_ERR`: Raised if the specified qualified name is not an XML name
       * according to {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#XML XML 1.0}.
       * - `NAMESPACE_ERR`: Raised if the qualifiedName is malformed, if the qualifiedName has a
       * prefix and the namespaceURI is null, or if the qualifiedName is null and the namespaceURI
       * is different from null, or if the qualifiedName has a prefix that is "xml" and the
       * namespaceURI is different from "{@link http://www.w3.org/XML/1998/namespace}"
       * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#Namespaces XML Namespaces},
       * or if the DOM implementation does not support the "XML" feature but a non-null namespace
       * URI was provided, since namespaces were defined by XML.
       * - `WRONG_DOCUMENT_ERR`: Raised if doctype has already been used with a different document
       * or was created from a different implementation.
       * - `NOT_SUPPORTED_ERR`: May be raised if the implementation does not support the feature
       * "XML" and the language exposed through the Document does not support XML Namespaces (such
       * as {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#HTML40 HTML 4.01}).
       * @since DOM Level 2.
       * @see {@link #createHTMLDocument}
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocument MDN
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument DOM Living Standard
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Level-2-Core-DOM-createDocument DOM
       *      Level 3 Core
       * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocument DOM
       *      Level 2 Core (initial)
       */
      createDocument: function(namespaceURI, qualifiedName, doctype) {
        var contentType = MIME_TYPE.XML_APPLICATION;
        if (namespaceURI === NAMESPACE.HTML) {
          contentType = MIME_TYPE.XML_XHTML_APPLICATION;
        } else if (namespaceURI === NAMESPACE.SVG) {
          contentType = MIME_TYPE.XML_SVG_IMAGE;
        }
        var doc = new Document(PDC, { contentType });
        doc.implementation = this;
        doc.childNodes = new NodeList();
        doc.doctype = doctype || null;
        if (doctype) {
          doc.appendChild(doctype);
        }
        if (qualifiedName) {
          var root = doc.createElementNS(namespaceURI, qualifiedName);
          doc.appendChild(root);
        }
        return doc;
      },
      /**
       * Creates an empty DocumentType node. Entity declarations and notations are not made
       * available. Entity reference expansions and default attribute additions do not occur.
       *
       * **This behavior is slightly different from the one in the specs**:
       * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
       * - `publicId` and `systemId` contain the raw data including any possible quotes,
       *   so they can always be serialized back to the original value
       * - `internalSubset` contains the raw string between `[` and `]` if present,
       *   but is not parsed or validated in any form.
       *
       * @function DOMImplementation#createDocumentType
       * @param {string} qualifiedName
       * The {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-qualifiedname qualified
       * name} of the document type to be created.
       * @param {string} [publicId]
       * The external subset public identifier. Stored verbatim including surrounding quotes.
       * When serialized with `requireWellFormed: true`, the serializer throws `InvalidStateError`
       * if the value is non-empty and does not match the XML `PubidLiteral` production
       * (W3C DOM Parsing §3.2.1.3; XML 1.0 production [12]). Creation-time validation is not
       * enforced — deferred to a future breaking release.
       * @param {string} [systemId]
       * The external subset system identifier. Stored verbatim including surrounding quotes.
       * When serialized with `requireWellFormed: true`, the serializer throws `InvalidStateError`
       * if the value is non-empty and does not match the XML `SystemLiteral` production
       * (W3C DOM Parsing §3.2.1.3; XML 1.0 production [11]). Creation-time validation is not
       * enforced — deferred to a future breaking release.
       * @param {string} [internalSubset]
       * The internal subset or an empty string if it is not present. Stored verbatim.
       * When serialized with `requireWellFormed: true`, the serializer throws `InvalidStateError`
       * if the value contains `"]>"`. Creation-time validation is not enforced.
       * @returns {DocumentType}
       * A new {@link DocumentType} node with {@link Node#ownerDocument} set to null.
       * @throws {DOMException}
       * With code:
       *
       * - `INVALID_CHARACTER_ERR`: Raised if the specified qualified name is not an XML name
       * according to {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#XML XML 1.0}.
       * - `NAMESPACE_ERR`: Raised if the qualifiedName is malformed.
       * - `NOT_SUPPORTED_ERR`: May be raised if the implementation does not support the feature
       * "XML" and the language exposed through the Document does not support XML Namespaces (such
       * as {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#HTML40 HTML 4.01}).
       * @since DOM Level 2.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocumentType
       *      MDN
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype DOM Living
       *      Standard
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Level-3-Core-DOM-createDocType DOM
       *      Level 3 Core
       * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocType DOM
       *      Level 2 Core
       * @see https://github.com/xmldom/xmldom/blob/master/CHANGELOG.md#050
       * @see https://www.w3.org/TR/DOM-Level-2-Core/#core-ID-Core-DocType-internalSubset
       * @prettierignore
       */
      createDocumentType: function(qualifiedName, publicId, systemId, internalSubset) {
        validateQualifiedName(qualifiedName);
        var node = new DocumentType(PDC);
        node.name = qualifiedName;
        node.nodeName = qualifiedName;
        node.publicId = publicId || "";
        node.systemId = systemId || "";
        node.internalSubset = internalSubset || "";
        node.childNodes = new NodeList();
        return node;
      },
      /**
       * Returns an HTML document, that might already have a basic DOM structure.
       *
       * __It behaves slightly different from the description in the living standard__:
       * - If the first argument is `false` no initial nodes are added (steps 3-7 in the specs are
       * omitted)
       * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
       *
       * @param {string | false} [title]
       * A string containing the title to give the new HTML document.
       * @returns {Document}
       * The HTML document.
       * @since WHATWG Living Standard.
       * @see {@link #createDocument}
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createhtmldocument
       * @see https://dom.spec.whatwg.org/#html-document
       */
      createHTMLDocument: function(title) {
        var doc = new Document(PDC, { contentType: MIME_TYPE.HTML });
        doc.implementation = this;
        doc.childNodes = new NodeList();
        if (title !== false) {
          doc.doctype = this.createDocumentType("html");
          doc.doctype.ownerDocument = doc;
          doc.appendChild(doc.doctype);
          var htmlNode = doc.createElement("html");
          doc.appendChild(htmlNode);
          var headNode = doc.createElement("head");
          htmlNode.appendChild(headNode);
          if (typeof title === "string") {
            var titleNode = doc.createElement("title");
            titleNode.appendChild(doc.createTextNode(title));
            headNode.appendChild(titleNode);
          }
          htmlNode.appendChild(doc.createElement("body"));
        }
        return doc;
      }
    };
    function Node(symbol) {
      checkSymbol(symbol);
    }
    Node.prototype = {
      /**
       * The first child of this node.
       *
       * @type {Node | null}
       */
      firstChild: null,
      /**
       * The last child of this node.
       *
       * @type {Node | null}
       */
      lastChild: null,
      /**
       * The previous sibling of this node.
       *
       * @type {Node | null}
       */
      previousSibling: null,
      /**
       * The next sibling of this node.
       *
       * @type {Node | null}
       */
      nextSibling: null,
      /**
       * The parent node of this node.
       *
       * @type {Node | null}
       */
      parentNode: null,
      /**
       * The parent element of this node.
       *
       * @type {Element | null}
       */
      get parentElement() {
        return this.parentNode && this.parentNode.nodeType === this.ELEMENT_NODE ? this.parentNode : null;
      },
      /**
       * The child nodes of this node.
       *
       * @type {NodeList}
       */
      childNodes: null,
      /**
       * The document object associated with this node.
       *
       * @type {Document | null}
       */
      ownerDocument: null,
      /**
       * The value of this node.
       *
       * @type {string | null}
       */
      nodeValue: null,
      /**
       * The namespace URI of this node.
       *
       * @type {string | null}
       */
      namespaceURI: null,
      /**
       * The prefix of the namespace for this node.
       *
       * @type {string | null}
       */
      prefix: null,
      /**
       * The local part of the qualified name of this node.
       *
       * @type {string | null}
       */
      localName: null,
      /**
       * The baseURI is currently always `about:blank`,
       * since that's what happens when you create a document from scratch.
       *
       * @type {'about:blank'}
       */
      baseURI: "about:blank",
      /**
       * Is true if this node is part of a document.
       *
       * @type {boolean}
       */
      get isConnected() {
        var rootNode = this.getRootNode();
        return rootNode && rootNode.nodeType === rootNode.DOCUMENT_NODE;
      },
      /**
       * Checks whether `other` is an inclusive descendant of this node.
       *
       * @param {Node | null | undefined} other
       * The node to check.
       * @returns {boolean}
       * True if `other` is an inclusive descendant of this node; false otherwise.
       * @see https://dom.spec.whatwg.org/#dom-node-contains
       */
      contains: function(other) {
        if (!other) return false;
        var parent = other;
        do {
          if (this === parent) return true;
          parent = parent.parentNode;
        } while (parent);
        return false;
      },
      /**
       * @typedef GetRootNodeOptions
       * @property {boolean} [composed=false]
       */
      /**
       * Searches for the root node of this node.
       *
       * **This behavior is slightly different from the in the specs**:
       * - ignores `options.composed`, since `ShadowRoot`s are unsupported, always returns root.
       *
       * @param {GetRootNodeOptions} [options]
       * @returns {Node}
       * Root node.
       * @see https://dom.spec.whatwg.org/#dom-node-getrootnode
       * @see https://dom.spec.whatwg.org/#concept-shadow-including-root
       */
      getRootNode: function(options) {
        var parent = this;
        do {
          if (!parent.parentNode) {
            return parent;
          }
          parent = parent.parentNode;
        } while (parent);
      },
      /**
       * Checks whether the given node is equal to this node.
       *
       * Two nodes are equal when they have the same type, defining characteristics (for the type),
       * and the same childNodes. The comparison is iterative to avoid stack overflows on
       * deeply-nested trees. Attribute nodes of each Element pair are also pushed onto the stack
       * and compared the same way.
       *
       * @param {Node} [otherNode]
       * @returns {boolean}
       * @see https://dom.spec.whatwg.org/#concept-node-equals
       * @see ../docs/walk-dom.md.
       */
      isEqualNode: function(otherNode) {
        if (!otherNode) return false;
        var stack = [{ node: this, other: otherNode }];
        while (stack.length > 0) {
          var pair = stack.pop();
          var node = pair.node;
          var other = pair.other;
          if (node.nodeType !== other.nodeType) return false;
          switch (node.nodeType) {
            case node.DOCUMENT_TYPE_NODE:
              if (node.name !== other.name) return false;
              if (node.publicId !== other.publicId) return false;
              if (node.systemId !== other.systemId) return false;
              break;
            case node.ELEMENT_NODE:
              if (node.namespaceURI !== other.namespaceURI) return false;
              if (node.prefix !== other.prefix) return false;
              if (node.localName !== other.localName) return false;
              if (node.attributes.length !== other.attributes.length) return false;
              for (var i = 0; i < node.attributes.length; i++) {
                var attr = node.attributes.item(i);
                var otherAttr = other.getAttributeNodeNS(attr.namespaceURI, attr.localName);
                if (!otherAttr) return false;
                stack.push({ node: attr, other: otherAttr });
              }
              break;
            case node.ATTRIBUTE_NODE:
              if (node.namespaceURI !== other.namespaceURI) return false;
              if (node.localName !== other.localName) return false;
              if (node.value !== other.value) return false;
              break;
            case node.PROCESSING_INSTRUCTION_NODE:
              if (node.target !== other.target || node.data !== other.data) return false;
              break;
            case node.TEXT_NODE:
            case node.CDATA_SECTION_NODE:
            case node.COMMENT_NODE:
              if (node.data !== other.data) return false;
              break;
          }
          if (node.childNodes.length !== other.childNodes.length) return false;
          for (var i = node.childNodes.length - 1; i >= 0; i--) {
            stack.push({ node: node.childNodes[i], other: other.childNodes[i] });
          }
        }
        return true;
      },
      /**
       * Checks whether or not the given node is this node.
       *
       * @param {Node} [otherNode]
       */
      isSameNode: function(otherNode) {
        return this === otherNode;
      },
      /**
       * Inserts a node before a reference node as a child of this node.
       *
       * @param {Node} newChild
       * The new child node to be inserted.
       * @param {Node | null} refChild
       * The reference node before which newChild will be inserted.
       * @returns {Node}
       * The new child node successfully inserted.
       * @throws {DOMException}
       * Throws a DOMException if inserting the node would result in a DOM tree that is not
       * well-formed, or if `child` is provided but is not a child of `parent`.
       * See {@link _insertBefore} for more details.
       * @since Modified in DOM L2
       */
      insertBefore: function(newChild, refChild) {
        return _insertBefore(this, newChild, refChild);
      },
      /**
       * Replaces an old child node with a new child node within this node.
       *
       * @param {Node} newChild
       * The new node that is to replace the old node.
       * If it already exists in the DOM, it is removed from its original position.
       * @param {Node} oldChild
       * The existing child node to be replaced.
       * @returns {Node}
       * Returns the replaced child node.
       * @throws {DOMException}
       * Throws a DOMException if replacing the node would result in a DOM tree that is not
       * well-formed, or if `oldChild` is not a child of `this`.
       * This can also occur if the pre-replacement validity assertion fails.
       * See {@link _insertBefore}, {@link Node.removeChild}, and
       * {@link assertPreReplacementValidityInDocument} for more details.
       * @see https://dom.spec.whatwg.org/#concept-node-replace
       */
      replaceChild: function(newChild, oldChild) {
        _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
        if (oldChild) {
          this.removeChild(oldChild);
        }
      },
      /**
       * Removes an existing child node from this node.
       *
       * @param {Node} oldChild
       * The child node to be removed.
       * @returns {Node}
       * Returns the removed child node.
       * @throws {DOMException}
       * Throws a DOMException if `oldChild` is not a child of `this`.
       * See {@link _removeChild} for more details.
       */
      removeChild: function(oldChild) {
        return _removeChild(this, oldChild);
      },
      /**
       * Appends a child node to this node.
       *
       * @param {Node} newChild
       * The child node to be appended to this node.
       * If it already exists in the DOM, it is removed from its original position.
       * @returns {Node}
       * Returns the appended child node.
       * @throws {DOMException}
       * Throws a DOMException if appending the node would result in a DOM tree that is not
       * well-formed, or if `newChild` is not a valid Node.
       * See {@link insertBefore} for more details.
       */
      appendChild: function(newChild) {
        return this.insertBefore(newChild, null);
      },
      /**
       * Determines whether this node has any child nodes.
       *
       * @returns {boolean}
       * Returns true if this node has any child nodes, and false otherwise.
       */
      hasChildNodes: function() {
        return this.firstChild != null;
      },
      /**
       * Creates a copy of the calling node.
       *
       * @param {boolean} deep
       * If true, the contents of the node are recursively copied.
       * If false, only the node itself (and its attributes, if it is an element) are copied.
       * @returns {Node}
       * Returns the newly created copy of the node.
       * @throws {DOMException}
       * May throw a DOMException if operations within {@link Element#setAttributeNode} or
       * {@link Node#appendChild} (which are potentially invoked in this method) do not meet their
       * specific constraints.
       * @see {@link cloneNode}
       */
      cloneNode: function(deep) {
        return cloneNode(this.ownerDocument || this, this, deep);
      },
      /**
       * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
       * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
       *
       * Specifically, this method merges any adjacent text nodes (i.e., nodes for which `nodeType`
       * is `TEXT_NODE`) into a single node with the combined data. It also removes any empty text
       * nodes.
       *
       * This method iterativly traverses all child nodes to normalize all descendent nodes within
       * the subtree.
       *
       * @throws {DOMException}
       * May throw a DOMException if operations within removeChild or appendData (which are
       * potentially invoked in this method) do not meet their specific constraints.
       * @since Modified in DOM Level 2
       * @see {@link Node.removeChild}
       * @see {@link CharacterData.appendData}
       * @see ../docs/walk-dom.md.
       */
      normalize: function() {
        walkDOM(this, null, {
          enter: function(node) {
            var child2 = node.firstChild;
            while (child2) {
              var next = child2.nextSibling;
              if (next !== null && next.nodeType === TEXT_NODE && child2.nodeType === TEXT_NODE) {
                var tail = [];
                var sibling = next;
                while (sibling !== null && sibling.nodeType === TEXT_NODE) {
                  tail.push(sibling.data);
                  sibling = sibling.nextSibling;
                }
                var removed = child2.nextSibling;
                while (removed !== sibling) {
                  var following = removed.nextSibling;
                  removed.parentNode = null;
                  removed.previousSibling = null;
                  removed.nextSibling = null;
                  removed = following;
                }
                child2.nextSibling = sibling;
                if (sibling !== null) {
                  sibling.previousSibling = child2;
                } else {
                  node.lastChild = child2;
                }
                child2.appendData(tail.join(""));
                _onUpdateChild(node.ownerDocument, node);
                child2 = sibling;
              } else {
                child2 = next;
              }
            }
            return true;
          }
        });
      },
      /**
       * Checks whether the DOM implementation implements a specific feature and its version.
       *
       * @deprecated
       * Since `DOMImplementation.hasFeature` is deprecated and always returns true.
       * @param {string} feature
       * The package name of the feature to test. This is the same name that can be passed to the
       * method `hasFeature` on `DOMImplementation`.
       * @param {string} version
       * This is the version number of the package name to test.
       * @returns {boolean}
       * Returns true in all cases in the current implementation.
       * @since Introduced in DOM Level 2
       * @see {@link DOMImplementation.hasFeature}
       */
      isSupported: function(feature, version2) {
        return this.ownerDocument.implementation.hasFeature(feature, version2);
      },
      /**
       * Look up the prefix associated to the given namespace URI, starting from this node.
       * **The default namespace declarations are ignored by this method.**
       * See Namespace Prefix Lookup for details on the algorithm used by this method.
       *
       * **This behavior is different from the in the specs**:
       * - no node type specific handling
       * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
       *
       * @param {string | null} namespaceURI
       * The namespace URI for which to find the associated prefix.
       * @returns {string | null}
       * The associated prefix, if found; otherwise, null.
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespacePrefix
       * @see https://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#lookupNamespacePrefixAlgo
       * @see https://dom.spec.whatwg.org/#dom-node-lookupprefix
       * @see https://github.com/xmldom/xmldom/issues/322
       * @prettierignore
       */
      lookupPrefix: function(namespaceURI) {
        var el = this;
        while (el) {
          var map = el._nsMap;
          if (map) {
            for (var n in map) {
              if (hasOwn(map, n) && map[n] === namespaceURI) {
                return n;
              }
            }
          }
          el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
        }
        return null;
      },
      /**
       * This function is used to look up the namespace URI associated with the given prefix,
       * starting from this node.
       *
       * **This behavior is different from the in the specs**:
       * - no node type specific handling
       * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
       *
       * @param {string | null} prefix
       * The prefix for which to find the associated namespace URI.
       * @returns {string | null}
       * The associated namespace URI, if found; otherwise, null.
       * @since DOM Level 3
       * @see https://dom.spec.whatwg.org/#dom-node-lookupnamespaceuri
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespaceURI
       * @prettierignore
       */
      lookupNamespaceURI: function(prefix) {
        var el = this;
        while (el) {
          var map = el._nsMap;
          if (map) {
            if (hasOwn(map, prefix)) {
              return map[prefix];
            }
          }
          el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
        }
        return null;
      },
      /**
       * Determines whether the given namespace URI is the default namespace.
       *
       * The function works by looking up the prefix associated with the given namespace URI. If no
       * prefix is found (i.e., the namespace URI is not registered in the namespace map of this
       * node or any of its ancestors), it returns `true`, implying the namespace URI is considered
       * the default.
       *
       * **This behavior is different from the in the specs**:
       * - no node type specific handling
       * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
       *
       * @param {string | null} namespaceURI
       * The namespace URI to be checked.
       * @returns {boolean}
       * Returns true if the given namespace URI is the default namespace, false otherwise.
       * @since DOM Level 3
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-isDefaultNamespace
       * @see https://dom.spec.whatwg.org/#dom-node-isdefaultnamespace
       * @prettierignore
       */
      isDefaultNamespace: function(namespaceURI) {
        var prefix = this.lookupPrefix(namespaceURI);
        return prefix == null;
      },
      /**
       * Compares the reference node with a node with regard to their position in the document and
       * according to the document order.
       *
       * @param {Node} other
       * The node to compare the reference node to.
       * @returns {number}
       * Returns how the node is positioned relatively to the reference node according to the
       * bitmask. 0 if reference node and given node are the same.
       * @since DOM Level 3
       * @see https://www.w3.org/TR/2004/REC-DOM-Level-3-Core-20040407/core.html#Node3-compare
       * @see https://dom.spec.whatwg.org/#dom-node-comparedocumentposition
       */
      compareDocumentPosition: function(other) {
        if (this === other) return 0;
        var node1 = other;
        var node2 = this;
        var attr1 = null;
        var attr2 = null;
        if (node1 instanceof Attr) {
          attr1 = node1;
          node1 = attr1.ownerElement;
        }
        if (node2 instanceof Attr) {
          attr2 = node2;
          node2 = attr2.ownerElement;
          if (attr1 && node1 && node2 === node1) {
            for (var i = 0, attr; attr = node2.attributes[i]; i++) {
              if (attr === attr1)
                return DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
              if (attr === attr2)
                return DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
            }
          }
        }
        if (!node1 || !node2 || node2.ownerDocument !== node1.ownerDocument) {
          return DocumentPosition.DOCUMENT_POSITION_DISCONNECTED + DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + (docGUID(node2.ownerDocument) > docGUID(node1.ownerDocument) ? DocumentPosition.DOCUMENT_POSITION_FOLLOWING : DocumentPosition.DOCUMENT_POSITION_PRECEDING);
        }
        if (attr2 && node1 === node2) {
          return DocumentPosition.DOCUMENT_POSITION_CONTAINS + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
        }
        if (attr1 && node1 === node2) {
          return DocumentPosition.DOCUMENT_POSITION_CONTAINED_BY + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
        }
        var chain1 = [];
        var ancestor1 = node1.parentNode;
        while (ancestor1) {
          if (!attr2 && ancestor1 === node2) {
            return DocumentPosition.DOCUMENT_POSITION_CONTAINED_BY + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
          }
          chain1.push(ancestor1);
          ancestor1 = ancestor1.parentNode;
        }
        chain1.reverse();
        var chain2 = [];
        var ancestor2 = node2.parentNode;
        while (ancestor2) {
          if (!attr1 && ancestor2 === node1) {
            return DocumentPosition.DOCUMENT_POSITION_CONTAINS + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
          }
          chain2.push(ancestor2);
          ancestor2 = ancestor2.parentNode;
        }
        chain2.reverse();
        var ca = commonAncestor(chain1, chain2);
        for (var n in ca.childNodes) {
          var child2 = ca.childNodes[n];
          if (child2 === node2) return DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
          if (child2 === node1) return DocumentPosition.DOCUMENT_POSITION_PRECEDING;
          if (chain2.indexOf(child2) >= 0) return DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
          if (chain1.indexOf(child2) >= 0) return DocumentPosition.DOCUMENT_POSITION_PRECEDING;
        }
        return 0;
      }
    };
    function _xmlEncoder(c) {
      return c == "<" && "&lt;" || c == ">" && "&gt;" || c == "&" && "&amp;" || c == '"' && "&quot;" || "&#" + c.charCodeAt() + ";";
    }
    copy(NodeType, Node);
    copy(NodeType, Node.prototype);
    copy(DocumentPosition, Node);
    copy(DocumentPosition, Node.prototype);
    function _visitNode(node, callback) {
      walkDOM(node, null, {
        enter: function(n) {
          return callback(n) ? walkDOM.STOP : true;
        }
      });
    }
    function walkDOM(node, context, callbacks) {
      var stack = [{ node, context, phase: walkDOM.ENTER }];
      while (stack.length > 0) {
        var frame = stack.pop();
        if (frame.phase === walkDOM.ENTER) {
          var childContext = callbacks.enter(frame.node, frame.context);
          if (childContext === walkDOM.STOP) {
            return walkDOM.STOP;
          }
          stack.push({ node: frame.node, context: childContext, phase: walkDOM.EXIT });
          if (childContext === null || childContext === void 0) {
            continue;
          }
          var child2 = frame.node.lastChild;
          while (child2) {
            stack.push({ node: child2, context: childContext, phase: walkDOM.ENTER });
            child2 = child2.previousSibling;
          }
        } else {
          if (callbacks.exit) {
            callbacks.exit(frame.node, frame.context);
          }
        }
      }
    }
    walkDOM.STOP = /* @__PURE__ */ Symbol("walkDOM.STOP");
    walkDOM.ENTER = 0;
    walkDOM.EXIT = 1;
    function Document(symbol, options) {
      checkSymbol(symbol);
      var opt = options || {};
      this.ownerDocument = this;
      this.contentType = opt.contentType || MIME_TYPE.XML_APPLICATION;
      this.type = isHTMLMimeType(this.contentType) ? "html" : "xml";
    }
    function _onAddAttribute(doc, el, newAttr) {
      doc && doc._inc++;
      var ns = newAttr.namespaceURI;
      if (ns === NAMESPACE.XMLNS) {
        el._nsMap[newAttr.prefix ? newAttr.localName : ""] = newAttr.value;
      }
    }
    function _onRemoveAttribute(doc, el, newAttr, remove) {
      doc && doc._inc++;
      var ns = newAttr.namespaceURI;
      if (ns === NAMESPACE.XMLNS) {
        delete el._nsMap[newAttr.prefix ? newAttr.localName : ""];
      }
    }
    function _onUpdateChild(doc, parent, newChild) {
      if (doc && doc._inc) {
        doc._inc++;
        var childNodes = parent.childNodes;
        if (newChild && !newChild.nextSibling) {
          childNodes[childNodes.length++] = newChild;
        } else {
          var child2 = parent.firstChild;
          var i = 0;
          while (child2) {
            childNodes[i++] = child2;
            child2 = child2.nextSibling;
          }
          childNodes.length = i;
          delete childNodes[childNodes.length];
        }
      }
    }
    function _removeChild(parentNode, child2) {
      if (parentNode !== child2.parentNode) {
        throw new DOMException(DOMException.NOT_FOUND_ERR, "child's parent is not parent");
      }
      var oldPreviousSibling = child2.previousSibling;
      var oldNextSibling = child2.nextSibling;
      if (oldPreviousSibling) {
        oldPreviousSibling.nextSibling = oldNextSibling;
      } else {
        parentNode.firstChild = oldNextSibling;
      }
      if (oldNextSibling) {
        oldNextSibling.previousSibling = oldPreviousSibling;
      } else {
        parentNode.lastChild = oldPreviousSibling;
      }
      _onUpdateChild(parentNode.ownerDocument, parentNode);
      child2.parentNode = null;
      child2.previousSibling = null;
      child2.nextSibling = null;
      return child2;
    }
    function hasValidParentNodeType(node) {
      return node && (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE);
    }
    function hasInsertableNodeType(node) {
      return node && (node.nodeType === Node.CDATA_SECTION_NODE || node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.DOCUMENT_TYPE_NODE || node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE || node.nodeType === Node.TEXT_NODE);
    }
    function isDocTypeNode(node) {
      return node && node.nodeType === Node.DOCUMENT_TYPE_NODE;
    }
    function isElementNode(node) {
      return node && node.nodeType === Node.ELEMENT_NODE;
    }
    function isTextNode(node) {
      return node && node.nodeType === Node.TEXT_NODE;
    }
    function isElementInsertionPossible(doc, child2) {
      var parentChildNodes = doc.childNodes || [];
      if (find(parentChildNodes, isElementNode) || isDocTypeNode(child2)) {
        return false;
      }
      var docTypeNode = find(parentChildNodes, isDocTypeNode);
      return !(child2 && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child2));
    }
    function isElementReplacementPossible(doc, child2) {
      var parentChildNodes = doc.childNodes || [];
      function hasElementChildThatIsNotChild(node) {
        return isElementNode(node) && node !== child2;
      }
      if (find(parentChildNodes, hasElementChildThatIsNotChild)) {
        return false;
      }
      var docTypeNode = find(parentChildNodes, isDocTypeNode);
      return !(child2 && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child2));
    }
    function assertPreInsertionValidity1to5(parent, node, child2) {
      if (!hasValidParentNodeType(parent)) {
        throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Unexpected parent node type " + parent.nodeType);
      }
      if (child2 && child2.parentNode !== parent) {
        throw new DOMException(DOMException.NOT_FOUND_ERR, "child not in parent");
      }
      if (
        // 4. If `node` is not a DocumentFragment, DocumentType, Element, or CharacterData node, then throw a "HierarchyRequestError" DOMException.
        !hasInsertableNodeType(node) || // 5. If either `node` is a Text node and `parent` is a document,
        // the sax parser currently adds top level text nodes, this will be fixed in 0.9.0
        // || (node.nodeType === Node.TEXT_NODE && parent.nodeType === Node.DOCUMENT_NODE)
        // or `node` is a doctype and `parent` is not a document, then throw a "HierarchyRequestError" DOMException.
        isDocTypeNode(node) && parent.nodeType !== Node.DOCUMENT_NODE
      ) {
        throw new DOMException(
          DOMException.HIERARCHY_REQUEST_ERR,
          "Unexpected node type " + node.nodeType + " for parent node type " + parent.nodeType
        );
      }
    }
    function assertPreInsertionValidityInDocument(parent, node, child2) {
      var parentChildNodes = parent.childNodes || [];
      var nodeChildNodes = node.childNodes || [];
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        var nodeChildElements = nodeChildNodes.filter(isElementNode);
        if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
        }
        if (nodeChildElements.length === 1 && !isElementInsertionPossible(parent, child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
        }
      }
      if (isElementNode(node)) {
        if (!isElementInsertionPossible(parent, child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
        }
      }
      if (isDocTypeNode(node)) {
        if (find(parentChildNodes, isDocTypeNode)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
        }
        var parentElementChild = find(parentChildNodes, isElementNode);
        if (child2 && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
        }
        if (!child2 && parentElementChild) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can not be appended since element is present");
        }
      }
    }
    function assertPreReplacementValidityInDocument(parent, node, child2) {
      var parentChildNodes = parent.childNodes || [];
      var nodeChildNodes = node.childNodes || [];
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        var nodeChildElements = nodeChildNodes.filter(isElementNode);
        if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
        }
        if (nodeChildElements.length === 1 && !isElementReplacementPossible(parent, child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
        }
      }
      if (isElementNode(node)) {
        if (!isElementReplacementPossible(parent, child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
        }
      }
      if (isDocTypeNode(node)) {
        let hasDoctypeChildThatIsNotChild = function(node2) {
          return isDocTypeNode(node2) && node2 !== child2;
        };
        if (find(parentChildNodes, hasDoctypeChildThatIsNotChild)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
        }
        var parentElementChild = find(parentChildNodes, isElementNode);
        if (child2 && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child2)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
        }
      }
    }
    function _insertBefore(parent, node, child2, _inDocumentAssertion) {
      assertPreInsertionValidity1to5(parent, node, child2);
      if (parent.nodeType === Node.DOCUMENT_NODE) {
        (_inDocumentAssertion || assertPreInsertionValidityInDocument)(parent, node, child2);
      }
      var cp = node.parentNode;
      if (cp) {
        cp.removeChild(node);
      }
      if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
        var newFirst = node.firstChild;
        if (newFirst == null) {
          return node;
        }
        var newLast = node.lastChild;
      } else {
        newFirst = newLast = node;
      }
      var pre = child2 ? child2.previousSibling : parent.lastChild;
      newFirst.previousSibling = pre;
      newLast.nextSibling = child2;
      if (pre) {
        pre.nextSibling = newFirst;
      } else {
        parent.firstChild = newFirst;
      }
      if (child2 == null) {
        parent.lastChild = newLast;
      } else {
        child2.previousSibling = newLast;
      }
      do {
        newFirst.parentNode = parent;
      } while (newFirst !== newLast && (newFirst = newFirst.nextSibling));
      _onUpdateChild(parent.ownerDocument || parent, parent, node);
      if (node.nodeType == DOCUMENT_FRAGMENT_NODE) {
        node.firstChild = node.lastChild = null;
      }
      return node;
    }
    Document.prototype = {
      /**
       * The implementation that created this document.
       *
       * @type DOMImplementation
       * @readonly
       */
      implementation: null,
      nodeName: "#document",
      nodeType: DOCUMENT_NODE,
      /**
       * The DocumentType node of the document.
       *
       * @type DocumentType
       * @readonly
       */
      doctype: null,
      documentElement: null,
      _inc: 1,
      insertBefore: function(newChild, refChild) {
        if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
          var child2 = newChild.firstChild;
          while (child2) {
            var next = child2.nextSibling;
            this.insertBefore(child2, refChild);
            child2 = next;
          }
          return newChild;
        }
        _insertBefore(this, newChild, refChild);
        newChild.ownerDocument = this;
        if (this.documentElement === null && newChild.nodeType === ELEMENT_NODE) {
          this.documentElement = newChild;
        }
        return newChild;
      },
      removeChild: function(oldChild) {
        var removed = _removeChild(this, oldChild);
        if (removed === this.documentElement) {
          this.documentElement = null;
        }
        return removed;
      },
      replaceChild: function(newChild, oldChild) {
        _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
        newChild.ownerDocument = this;
        if (oldChild) {
          this.removeChild(oldChild);
        }
        if (isElementNode(newChild)) {
          this.documentElement = newChild;
        }
      },
      /**
       * Imports a node from another document into this document, creating a new copy owned by this
       * document. The source node and its subtree are not modified.
       *
       * @param {Node} importedNode
       * The node to import.
       * @param {boolean} deep
       * If true, the contents of the node are recursively imported.
       * If false, only the node itself (and its attributes, if it is an element) are imported.
       * @returns {Node}
       * Returns the newly created import of the node.
       * @see {@link importNode}
       * @see {@link https://dom.spec.whatwg.org/#dom-document-importnode}
       */
      importNode: function(importedNode, deep) {
        return importNode(this, importedNode, deep);
      },
      // Introduced in DOM Level 2:
      getElementById: function(id) {
        var rtv = null;
        _visitNode(this.documentElement, function(node) {
          if (node.nodeType == ELEMENT_NODE) {
            if (node.getAttribute("id") == id) {
              rtv = node;
              return true;
            }
          }
        });
        return rtv;
      },
      /**
       * Creates a new `Element` that is owned by this `Document`.
       * In HTML Documents `localName` is the lower cased `tagName`,
       * otherwise no transformation is being applied.
       * When `contentType` implies the HTML namespace, it will be set as `namespaceURI`.
       *
       * __This implementation differs from the specification:__ - The provided name is not checked
       * against the `Name` production,
       * so no related error will be thrown.
       * - There is no interface `HTMLElement`, it is always an `Element`.
       * - There is no support for a second argument to indicate using custom elements.
       *
       * @param {string} tagName
       * @returns {Element}
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement
       * @see https://dom.spec.whatwg.org/#dom-document-createelement
       * @see https://dom.spec.whatwg.org/#concept-create-element
       */
      createElement: function(tagName) {
        var node = new Element(PDC);
        node.ownerDocument = this;
        if (this.type === "html") {
          tagName = tagName.toLowerCase();
        }
        if (hasDefaultHTMLNamespace(this.contentType)) {
          node.namespaceURI = NAMESPACE.HTML;
        }
        node.nodeName = tagName;
        node.tagName = tagName;
        node.localName = tagName;
        node.childNodes = new NodeList();
        var attrs = node.attributes = new NamedNodeMap();
        attrs._ownerElement = node;
        return node;
      },
      /**
       * @returns {DocumentFragment}
       */
      createDocumentFragment: function() {
        var node = new DocumentFragment(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        return node;
      },
      /**
       * @param {string} data
       * @returns {Text}
       */
      createTextNode: function(data) {
        var node = new Text(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.appendData(data);
        return node;
      },
      /**
       * @param {string} data
       * @returns {Comment}
       * @see https://dom.spec.whatwg.org/#dom-document-createcomment
       * @see https://www.w3.org/TR/xml/#NT-Comment XML 1.0 production [15]
       * @see https://www.w3.org/TR/DOM-Parsing/#dfn-concept-serialize-xml §3.2.1.3
       *
       *      Note: no validation is performed at creation time. When the resulting document is
       *      serialized with `requireWellFormed: true`, the serializer throws `InvalidStateError`
       *      if the comment data contains `--` anywhere, ends with `-`, or contains characters
       *      outside the XML Char production (W3C DOM Parsing §3.2.1.3). Without that option the
       *      data is emitted verbatim.
       */
      createComment: function(data) {
        var node = new Comment(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.appendData(data);
        return node;
      },
      /**
       * Returns a new CDATASection node whose data is `data`.
       *
       * __This implementation differs from the specification:__ - calling this method on an HTML
       * document does not throw `NotSupportedError`.
       *
       * @param {string} data
       * @returns {CDATASection}
       * @throws {DOMException}
       * With code `INVALID_CHARACTER_ERR` if `data` contains `"]]>"`.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createCDATASection
       * @see https://dom.spec.whatwg.org/#dom-document-createcdatasection
       */
      createCDATASection: function(data) {
        if (data.indexOf("]]>") !== -1) {
          throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'data contains "]]>"');
        }
        var node = new CDATASection(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.appendData(data);
        return node;
      },
      /**
       * Returns a ProcessingInstruction node whose target is target and data is data.
       *
       * __This behavior is slightly different from the in the specs__:
       * - it does not do any input validation on the arguments and doesn't throw
       * "InvalidCharacterError".
       *
       * Note: When the resulting document is serialized with `requireWellFormed: true`, the
       * serializer throws `InvalidStateError` if `.target` is not a valid XML `NCName` (a `Name`
       * with no colon) or is an ASCII case-insensitive match for `"xml"`, or if `.data` contains
       * `?>` or characters outside the XML Char production (W3C DOM Parsing §3.2.1.7). Without that
       * option the target and data are emitted verbatim.
       *
       * @param {string} target
       * @param {string} data
       * @returns {ProcessingInstruction}
       * @see https://developer.mozilla.org/docs/Web/API/Document/createProcessingInstruction
       * @see https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
       * @see https://www.w3.org/TR/DOM-Parsing/#dfn-concept-serialize-xml §3.2.1.7
       */
      createProcessingInstruction: function(target, data) {
        var node = new ProcessingInstruction(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.nodeName = node.target = target;
        node.nodeValue = node.data = data;
        return node;
      },
      /**
       * Creates an `Attr` node that is owned by this document.
       * In HTML Documents `localName` is the lower cased `name`,
       * otherwise no transformation is being applied.
       *
       * __This implementation differs from the specification:__ - The provided name is not checked
       * against the `Name` production,
       * so no related error will be thrown.
       *
       * @param {string} name
       * @returns {Attr}
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createAttribute
       * @see https://dom.spec.whatwg.org/#dom-document-createattribute
       */
      createAttribute: function(name) {
        if (!g.QName_exact.test(name)) {
          throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'invalid character in name "' + name + '"');
        }
        if (this.type === "html") {
          name = name.toLowerCase();
        }
        return this._createAttribute(name);
      },
      _createAttribute: function(name) {
        var node = new Attr(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.name = name;
        node.nodeName = name;
        node.localName = name;
        node.specified = true;
        return node;
      },
      /**
       * Creates an EntityReference object.
       * The current implementation does not fill the `childNodes` with those of the corresponding
       * `Entity`
       *
       * The `name` is validated against the XML `Name` production at creation time; an invalid name
       * throws `InvalidCharacterError`. When the resulting node is serialized with
       * `requireWellFormed: true`, the serializer re-validates `nodeName` against the XML `Name`
       * production and throws `InvalidStateError` if a later `nodeName` mutation made it invalid;
       * without that option the name is emitted verbatim.
       *
       * __This implementation differs from the specification:__ xmldom does not expand entities —
       * the parser resolves entity references inline and never constructs `EntityReference` nodes,
       * so this method is the only producer.
       *
       * @deprecated
       * In DOM Level 4.
       * @param {string} name
       * The name of the entity to reference. No namespace well-formedness checks are performed.
       * @returns {EntityReference}
       * @throws {DOMException}
       * With code `INVALID_CHARACTER_ERR` when `name` is not a valid XML `Name`.
       * @throws {DOMException}
       * with code `NOT_SUPPORTED_ERR` when the document is of type `html`
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-392B75AE
       */
      createEntityReference: function(name) {
        if (!g.Name_exact.test(name)) {
          throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'not a valid xml name "' + name + '"');
        }
        if (this.type === "html") {
          throw new DOMException("document is an html document", DOMExceptionName.NotSupportedError);
        }
        var node = new EntityReference(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.nodeName = name;
        return node;
      },
      // Introduced in DOM Level 2:
      /**
       * @param {string} namespaceURI
       * @param {string} qualifiedName
       * @returns {Element}
       */
      createElementNS: function(namespaceURI, qualifiedName) {
        var validated = validateAndExtract(namespaceURI, qualifiedName);
        var node = new Element(PDC);
        var attrs = node.attributes = new NamedNodeMap();
        node.childNodes = new NodeList();
        node.ownerDocument = this;
        node.nodeName = qualifiedName;
        node.tagName = qualifiedName;
        node.namespaceURI = validated[0];
        node.prefix = validated[1];
        node.localName = validated[2];
        attrs._ownerElement = node;
        return node;
      },
      // Introduced in DOM Level 2:
      /**
       * @param {string} namespaceURI
       * @param {string} qualifiedName
       * @returns {Attr}
       */
      createAttributeNS: function(namespaceURI, qualifiedName) {
        var validated = validateAndExtract(namespaceURI, qualifiedName);
        var node = new Attr(PDC);
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        node.nodeName = qualifiedName;
        node.name = qualifiedName;
        node.specified = true;
        node.namespaceURI = validated[0];
        node.prefix = validated[1];
        node.localName = validated[2];
        return node;
      }
    };
    _extends(Document, Node);
    function Element(symbol) {
      checkSymbol(symbol);
      this._nsMap = /* @__PURE__ */ Object.create(null);
    }
    Element.prototype = {
      nodeType: ELEMENT_NODE,
      /**
       * The attributes of this element.
       *
       * @type {NamedNodeMap | null}
       */
      attributes: null,
      getQualifiedName: function() {
        return this.prefix ? this.prefix + ":" + this.localName : this.localName;
      },
      _isInHTMLDocumentAndNamespace: function() {
        return this.ownerDocument.type === "html" && this.namespaceURI === NAMESPACE.HTML;
      },
      /**
       * Implementaton of Level2 Core function hasAttributes.
       *
       * @returns {boolean}
       * True if attribute list is not empty.
       * @see https://www.w3.org/TR/DOM-Level-2-Core/#core-ID-NodeHasAttrs
       */
      hasAttributes: function() {
        return !!(this.attributes && this.attributes.length);
      },
      hasAttribute: function(name) {
        return !!this.getAttributeNode(name);
      },
      /**
       * Returns element’s first attribute whose qualified name is `name`, and `null`
       * if there is no such attribute.
       *
       * @param {string} name
       * @returns {string | null}
       */
      getAttribute: function(name) {
        var attr = this.getAttributeNode(name);
        return attr ? attr.value : null;
      },
      getAttributeNode: function(name) {
        if (this._isInHTMLDocumentAndNamespace()) {
          name = name.toLowerCase();
        }
        return this.attributes.getNamedItem(name);
      },
      /**
       * Sets the value of element’s first attribute whose qualified name is qualifiedName to value.
       *
       * @param {string} name
       * @param {string} value
       */
      setAttribute: function(name, value2) {
        if (this._isInHTMLDocumentAndNamespace()) {
          name = name.toLowerCase();
        }
        var attr = this.getAttributeNode(name);
        if (attr) {
          attr.value = attr.nodeValue = "" + value2;
        } else {
          attr = this.ownerDocument._createAttribute(name);
          attr.value = attr.nodeValue = "" + value2;
          this.setAttributeNode(attr);
        }
      },
      removeAttribute: function(name) {
        var attr = this.getAttributeNode(name);
        attr && this.removeAttributeNode(attr);
      },
      setAttributeNode: function(newAttr) {
        return this.attributes.setNamedItem(newAttr);
      },
      setAttributeNodeNS: function(newAttr) {
        return this.attributes.setNamedItemNS(newAttr);
      },
      removeAttributeNode: function(oldAttr) {
        return this.attributes.removeNamedItem(oldAttr.nodeName);
      },
      //get real attribute name,and remove it by removeAttributeNode
      removeAttributeNS: function(namespaceURI, localName) {
        var old = this.getAttributeNodeNS(namespaceURI, localName);
        old && this.removeAttributeNode(old);
      },
      hasAttributeNS: function(namespaceURI, localName) {
        return this.getAttributeNodeNS(namespaceURI, localName) != null;
      },
      /**
       * Returns element’s attribute whose namespace is `namespaceURI` and local name is
       * `localName`,
       * or `null` if there is no such attribute.
       *
       * @param {string} namespaceURI
       * @param {string} localName
       * @returns {string | null}
       */
      getAttributeNS: function(namespaceURI, localName) {
        var attr = this.getAttributeNodeNS(namespaceURI, localName);
        return attr ? attr.value : null;
      },
      /**
       * Sets the value of element’s attribute whose namespace is `namespaceURI` and local name is
       * `localName` to value.
       *
       * @param {string} namespaceURI
       * @param {string} qualifiedName
       * @param {string} value
       * @see https://dom.spec.whatwg.org/#dom-element-setattributens
       */
      setAttributeNS: function(namespaceURI, qualifiedName, value2) {
        var validated = validateAndExtract(namespaceURI, qualifiedName);
        var localName = validated[2];
        var attr = this.getAttributeNodeNS(namespaceURI, localName);
        if (attr) {
          attr.value = attr.nodeValue = "" + value2;
        } else {
          attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
          attr.value = attr.nodeValue = "" + value2;
          this.setAttributeNode(attr);
        }
      },
      getAttributeNodeNS: function(namespaceURI, localName) {
        return this.attributes.getNamedItemNS(namespaceURI, localName);
      },
      /**
       * Returns a LiveNodeList of all child elements which have **all** of the given class name(s).
       *
       * Returns an empty list if `classNames` is an empty string or only contains HTML white space
       * characters.
       *
       * Warning: This returns a live LiveNodeList.
       * Changes in the DOM will reflect in the array as the changes occur.
       * If an element selected by this array no longer qualifies for the selector,
       * it will automatically be removed. Be aware of this for iteration purposes.
       *
       * @param {string} classNames
       * Is a string representing the class name(s) to match; multiple class names are separated by
       * (ASCII-)whitespace.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByClassName
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByClassName
       * @see https://dom.spec.whatwg.org/#concept-getelementsbyclassname
       */
      getElementsByClassName: function(classNames) {
        var classNamesSet = toOrderedSet(classNames);
        return new LiveNodeList(this, function(base) {
          var ls = [];
          if (classNamesSet.length > 0) {
            _visitNode(base, function(node) {
              if (node !== base && node.nodeType === ELEMENT_NODE) {
                var nodeClassNames = node.getAttribute("class");
                if (nodeClassNames) {
                  var matches = classNames === nodeClassNames;
                  if (!matches) {
                    var nodeClassNamesSet = toOrderedSet(nodeClassNames);
                    matches = classNamesSet.every(arrayIncludes(nodeClassNamesSet));
                  }
                  if (matches) {
                    ls.push(node);
                  }
                }
              }
            });
          }
          return ls;
        });
      },
      /**
       * Returns a LiveNodeList of elements with the given qualifiedName.
       * Searching for all descendants can be done by passing `*` as `qualifiedName`.
       *
       * All descendants of the specified element are searched, but not the element itself.
       * The returned list is live, which means it updates itself with the DOM tree automatically.
       * Therefore, there is no need to call `Element.getElementsByTagName()`
       * with the same element and arguments repeatedly if the DOM changes in between calls.
       *
       * When called on an HTML element in an HTML document,
       * `getElementsByTagName` lower-cases the argument before searching for it.
       * This is undesirable when trying to match camel-cased SVG elements (such as
       * `<linearGradient>`) in an HTML document.
       * Instead, use `Element.getElementsByTagNameNS()`,
       * which preserves the capitalization of the tag name.
       *
       * `Element.getElementsByTagName` is similar to `Document.getElementsByTagName()`,
       * except that it only searches for elements that are descendants of the specified element.
       *
       * @param {string} qualifiedName
       * @returns {LiveNodeList}
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByTagName
       * @see https://dom.spec.whatwg.org/#concept-getelementsbytagname
       */
      getElementsByTagName: function(qualifiedName) {
        var isHTMLDocument = (this.nodeType === DOCUMENT_NODE ? this : this.ownerDocument).type === "html";
        var lowerQualifiedName = qualifiedName.toLowerCase();
        return new LiveNodeList(this, function(base) {
          var ls = [];
          _visitNode(base, function(node) {
            if (node === base || node.nodeType !== ELEMENT_NODE) {
              return;
            }
            if (qualifiedName === "*") {
              ls.push(node);
            } else {
              var nodeQualifiedName = node.getQualifiedName();
              var matchingQName = isHTMLDocument && node.namespaceURI === NAMESPACE.HTML ? lowerQualifiedName : qualifiedName;
              if (nodeQualifiedName === matchingQName) {
                ls.push(node);
              }
            }
          });
          return ls;
        });
      },
      getElementsByTagNameNS: function(namespaceURI, localName) {
        return new LiveNodeList(this, function(base) {
          var ls = [];
          _visitNode(base, function(node) {
            if (node !== base && node.nodeType === ELEMENT_NODE && (namespaceURI === "*" || node.namespaceURI === namespaceURI) && (localName === "*" || node.localName == localName)) {
              ls.push(node);
            }
          });
          return ls;
        });
      }
    };
    Document.prototype.getElementsByClassName = Element.prototype.getElementsByClassName;
    Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
    Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;
    _extends(Element, Node);
    function Attr(symbol) {
      checkSymbol(symbol);
      this.namespaceURI = null;
      this.prefix = null;
      this.ownerElement = null;
    }
    Attr.prototype.nodeType = ATTRIBUTE_NODE;
    _extends(Attr, Node);
    function CharacterData(symbol) {
      checkSymbol(symbol);
    }
    CharacterData.prototype = {
      data: "",
      substringData: function(offset, count) {
        return this.data.substring(offset, offset + count);
      },
      appendData: function(text) {
        text = this.data + text;
        this.nodeValue = this.data = text;
        this.length = text.length;
      },
      insertData: function(offset, text) {
        this.replaceData(offset, 0, text);
      },
      deleteData: function(offset, count) {
        this.replaceData(offset, count, "");
      },
      replaceData: function(offset, count, text) {
        var start = this.data.substring(0, offset);
        var end = this.data.substring(offset + count);
        text = start + text + end;
        this.nodeValue = this.data = text;
        this.length = text.length;
      }
    };
    _extends(CharacterData, Node);
    function Text(symbol) {
      checkSymbol(symbol);
    }
    Text.prototype = {
      nodeName: "#text",
      nodeType: TEXT_NODE,
      splitText: function(offset) {
        var text = this.data;
        var newText = text.substring(offset);
        text = text.substring(0, offset);
        this.data = this.nodeValue = text;
        this.length = text.length;
        var newNode = this.ownerDocument.createTextNode(newText);
        if (this.parentNode) {
          this.parentNode.insertBefore(newNode, this.nextSibling);
        }
        return newNode;
      }
    };
    _extends(Text, CharacterData);
    function Comment(symbol) {
      checkSymbol(symbol);
    }
    Comment.prototype = {
      nodeName: "#comment",
      nodeType: COMMENT_NODE
    };
    _extends(Comment, CharacterData);
    function CDATASection(symbol) {
      checkSymbol(symbol);
    }
    CDATASection.prototype = {
      nodeName: "#cdata-section",
      nodeType: CDATA_SECTION_NODE
    };
    _extends(CDATASection, Text);
    function DocumentType(symbol) {
      checkSymbol(symbol);
    }
    DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
    _extends(DocumentType, Node);
    function Notation(symbol) {
      checkSymbol(symbol);
    }
    Notation.prototype.nodeType = NOTATION_NODE;
    _extends(Notation, Node);
    function Entity(symbol) {
      checkSymbol(symbol);
    }
    Entity.prototype.nodeType = ENTITY_NODE;
    _extends(Entity, Node);
    function EntityReference(symbol) {
      checkSymbol(symbol);
    }
    EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
    _extends(EntityReference, Node);
    function DocumentFragment(symbol) {
      checkSymbol(symbol);
    }
    DocumentFragment.prototype.nodeName = "#document-fragment";
    DocumentFragment.prototype.nodeType = DOCUMENT_FRAGMENT_NODE;
    _extends(DocumentFragment, Node);
    function ProcessingInstruction(symbol) {
      checkSymbol(symbol);
    }
    ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
    _extends(ProcessingInstruction, CharacterData);
    function XMLSerializer3() {
    }
    XMLSerializer3.prototype.serializeToString = function(node, options) {
      return nodeSerializeToString.call(node, options);
    };
    Node.prototype.toString = nodeSerializeToString;
    function nodeSerializeToString(options) {
      var opts;
      if (typeof options === "function") {
        opts = { requireWellFormed: false, splitCDATASections: true, nodeFilter: options };
      } else if (options != null) {
        opts = {
          requireWellFormed: !!options.requireWellFormed,
          splitCDATASections: options.splitCDATASections !== false,
          nodeFilter: options.nodeFilter || null
        };
      } else {
        opts = { requireWellFormed: false, splitCDATASections: true, nodeFilter: null };
      }
      var buf = [];
      var refNode = this.nodeType === DOCUMENT_NODE && this.documentElement || this;
      var prefix = refNode.prefix;
      var uri = refNode.namespaceURI;
      if (uri && prefix == null) {
        var prefix = refNode.lookupPrefix(uri);
        if (prefix == null) {
          var visibleNamespaces = [
            { namespace: uri, prefix: null }
            //{namespace:uri,prefix:''}
          ];
        }
      }
      serializeToString(this, buf, visibleNamespaces, opts);
      return buf.join("");
    }
    function needNamespaceDefine(node, isHTML, visibleNamespaces) {
      var prefix = node.prefix || "";
      var uri = node.namespaceURI;
      if (!uri) {
        return false;
      }
      if (prefix === "xml" && uri === NAMESPACE.XML || uri === NAMESPACE.XMLNS) {
        return false;
      }
      var i = visibleNamespaces.length;
      while (i--) {
        var ns = visibleNamespaces[i];
        if (ns.prefix === prefix) {
          return ns.namespace !== uri;
        }
      }
      return true;
    }
    function addSerializedAttribute(buf, qualifiedName, value2, requireWellFormed) {
      if (requireWellFormed && !g.QName_exact.test(qualifiedName)) {
        throw new DOMException(
          'The attribute name "' + qualifiedName + '" is not a valid XML QName',
          DOMExceptionName.InvalidStateError
        );
      }
      buf.push(" ", qualifiedName, '="', value2.replace(/[<>&"\t\n\r]/g, _xmlEncoder), '"');
    }
    function serializeToString(node, buf, visibleNamespaces, opts) {
      if (!visibleNamespaces) {
        visibleNamespaces = [];
      }
      var nodeFilter = opts.nodeFilter;
      var requireWellFormed = opts.requireWellFormed;
      var splitCDATASections = opts.splitCDATASections;
      var doc = node.nodeType === DOCUMENT_NODE ? node : node.ownerDocument;
      var isHTML = doc.type === "html";
      walkDOM(
        node,
        { ns: visibleNamespaces },
        {
          enter: function(n, ctx) {
            var namespaces = ctx.ns;
            if (nodeFilter) {
              n = nodeFilter(n);
              if (n) {
                if (typeof n == "string") {
                  buf.push(n);
                  return null;
                }
              } else {
                return null;
              }
            }
            switch (n.nodeType) {
              case ELEMENT_NODE:
                var attrs = n.attributes;
                var len = attrs.length;
                var nodeName = n.tagName;
                var prefixedNodeName = nodeName;
                if (!isHTML && !n.prefix && n.namespaceURI) {
                  var defaultNS;
                  for (var ai = 0; ai < attrs.length; ai++) {
                    if (attrs.item(ai).name === "xmlns") {
                      defaultNS = attrs.item(ai).value;
                      break;
                    }
                  }
                  if (!defaultNS) {
                    for (var nsi = namespaces.length - 1; nsi >= 0; nsi--) {
                      var nsEntry = namespaces[nsi];
                      if (nsEntry.prefix === "" && nsEntry.namespace === n.namespaceURI) {
                        defaultNS = nsEntry.namespace;
                        break;
                      }
                    }
                  }
                  if (defaultNS !== n.namespaceURI) {
                    for (var nsi = namespaces.length - 1; nsi >= 0; nsi--) {
                      var nsEntry = namespaces[nsi];
                      if (nsEntry.namespace === n.namespaceURI) {
                        if (nsEntry.prefix) {
                          prefixedNodeName = nsEntry.prefix + ":" + nodeName;
                        }
                        break;
                      }
                    }
                  }
                }
                if (requireWellFormed && !g.QName_exact.test(prefixedNodeName)) {
                  throw new DOMException(
                    'The element name "' + prefixedNodeName + '" is not a valid XML QName',
                    DOMExceptionName.InvalidStateError
                  );
                }
                buf.push("<", prefixedNodeName);
                var childNamespaces = namespaces.slice();
                for (var i = 0; i < len; i++) {
                  var attr = attrs.item(i);
                  if (attr.prefix == "xmlns") {
                    childNamespaces.push({
                      prefix: attr.localName,
                      namespace: attr.value
                    });
                  } else if (attr.nodeName == "xmlns") {
                    childNamespaces.push({ prefix: "", namespace: attr.value });
                  }
                }
                for (var i = 0; i < len; i++) {
                  var attr = attrs.item(i);
                  if (needNamespaceDefine(attr, isHTML, childNamespaces)) {
                    var attrPrefix = attr.prefix || "";
                    var uri = attr.namespaceURI;
                    addSerializedAttribute(buf, attrPrefix ? "xmlns:" + attrPrefix : "xmlns", uri, requireWellFormed);
                    childNamespaces.push({ prefix: attrPrefix, namespace: uri });
                  }
                  var filteredAttr = nodeFilter ? nodeFilter(attr) : attr;
                  if (filteredAttr) {
                    if (typeof filteredAttr === "string") {
                      buf.push(filteredAttr);
                    } else {
                      addSerializedAttribute(buf, filteredAttr.name, filteredAttr.value, requireWellFormed);
                    }
                  }
                }
                if (nodeName === prefixedNodeName && needNamespaceDefine(n, isHTML, childNamespaces)) {
                  var nodePrefix = n.prefix || "";
                  var uri = n.namespaceURI;
                  addSerializedAttribute(buf, nodePrefix ? "xmlns:" + nodePrefix : "xmlns", uri, requireWellFormed);
                  childNamespaces.push({ prefix: nodePrefix, namespace: uri });
                }
                var canCloseTag = !n.firstChild;
                if (canCloseTag && (isHTML || n.namespaceURI === NAMESPACE.HTML)) {
                  canCloseTag = isHTMLVoidElement(nodeName);
                }
                if (canCloseTag) {
                  buf.push("/>");
                  return null;
                }
                buf.push(">");
                if (isHTML && isHTMLRawTextElement(nodeName)) {
                  var child2 = n.firstChild;
                  while (child2) {
                    if (child2.data) {
                      buf.push(child2.data);
                    } else {
                      serializeToString(child2, buf, childNamespaces.slice(), opts);
                    }
                    child2 = child2.nextSibling;
                  }
                  buf.push("</", prefixedNodeName, ">");
                  return null;
                }
                return { ns: childNamespaces, tag: prefixedNodeName };
              case DOCUMENT_NODE:
              case DOCUMENT_FRAGMENT_NODE:
                if (requireWellFormed && n.nodeType === DOCUMENT_NODE && n.documentElement == null) {
                  throw new DOMException("The Document has no documentElement", DOMExceptionName.InvalidStateError);
                }
                return { ns: namespaces };
              case ATTRIBUTE_NODE:
                addSerializedAttribute(buf, n.name, n.value, requireWellFormed);
                return null;
              case TEXT_NODE:
                if (requireWellFormed && g.InvalidChar.test(n.data)) {
                  throw new DOMException(
                    "The Text node data contains characters outside the XML Char production",
                    DOMExceptionName.InvalidStateError
                  );
                }
                buf.push(n.data.replace(/[<&>]/g, _xmlEncoder));
                return null;
              case CDATA_SECTION_NODE:
                if (requireWellFormed && n.data.indexOf("]]>") !== -1) {
                  throw new DOMException('The CDATASection data contains "]]>"', DOMExceptionName.InvalidStateError);
                }
                if (splitCDATASections) {
                  buf.push(g.CDATA_START, n.data.replace(/]]>/g, "]]]]><![CDATA[>"), g.CDATA_END);
                } else {
                  buf.push(g.CDATA_START, n.data, g.CDATA_END);
                }
                return null;
              case COMMENT_NODE:
                if (requireWellFormed) {
                  if (g.InvalidChar.test(n.data)) {
                    throw new DOMException(
                      "The comment node data contains characters outside the XML Char production",
                      DOMExceptionName.InvalidStateError
                    );
                  }
                  if (n.data.indexOf("--") !== -1 || n.data[n.data.length - 1] === "-") {
                    throw new DOMException(
                      'The comment node data contains "--" or ends with "-"',
                      DOMExceptionName.InvalidStateError
                    );
                  }
                }
                buf.push(g.COMMENT_START, n.data, g.COMMENT_END);
                return null;
              case DOCUMENT_TYPE_NODE:
                var pubid = n.publicId;
                var sysid = n.systemId;
                if (requireWellFormed) {
                  if (!g.Name_exact.test(n.name)) {
                    throw new DOMException(
                      'The doctype name "' + n.name + '" is not a valid XML Name',
                      DOMExceptionName.InvalidStateError
                    );
                  }
                  if (pubid && !g.PubidLiteral_match.test(pubid)) {
                    throw new DOMException("DocumentType publicId is not a valid PubidLiteral", DOMExceptionName.InvalidStateError);
                  }
                  if (sysid && sysid !== "." && !g.SystemLiteral_match.test(sysid)) {
                    throw new DOMException("DocumentType systemId is not a valid SystemLiteral", DOMExceptionName.InvalidStateError);
                  }
                  if (n.internalSubset && n.internalSubset.indexOf("]>") !== -1) {
                    throw new DOMException('DocumentType internalSubset contains "]>"', DOMExceptionName.InvalidStateError);
                  }
                }
                buf.push(g.DOCTYPE_DECL_START, " ", n.name);
                if (pubid) {
                  buf.push(" ", g.PUBLIC, " ", pubid);
                  if (sysid && sysid !== ".") {
                    buf.push(" ", sysid);
                  }
                } else if (sysid && sysid !== ".") {
                  buf.push(" ", g.SYSTEM, " ", sysid);
                }
                if (n.internalSubset) {
                  buf.push(" [", n.internalSubset, "]");
                }
                buf.push(">");
                return null;
              case PROCESSING_INSTRUCTION_NODE:
                if (requireWellFormed) {
                  if (!g.NCName_exact.test(n.target) || n.target.toLowerCase() === "xml") {
                    throw new DOMException(
                      'The processing instruction target "' + n.target + '" is not a valid XML NCName or is reserved',
                      DOMExceptionName.InvalidStateError
                    );
                  }
                  if (g.InvalidChar.test(n.data)) {
                    throw new DOMException(
                      "The ProcessingInstruction data contains characters outside the XML Char production",
                      DOMExceptionName.InvalidStateError
                    );
                  }
                  if (n.data.indexOf("?>") !== -1) {
                    throw new DOMException('The ProcessingInstruction data contains "?>"', DOMExceptionName.InvalidStateError);
                  }
                }
                buf.push("<?", n.target, " ", n.data, "?>");
                return null;
              case ENTITY_REFERENCE_NODE:
                if (requireWellFormed && !g.Name_exact.test(n.nodeName)) {
                  throw new DOMException(
                    'The entity reference name "' + n.nodeName + '" is not a valid XML Name',
                    DOMExceptionName.InvalidStateError
                  );
                }
                buf.push("&", n.nodeName, ";");
                return null;
              //case ENTITY_NODE:
              //case NOTATION_NODE:
              default:
                buf.push("??", n.nodeName);
                return null;
            }
          },
          exit: function(n, childCtx) {
            if (childCtx && childCtx.tag) {
              buf.push("</", childCtx.tag, ">");
            }
          }
        }
      );
    }
    function importNode(doc, node, deep) {
      var destRoot;
      walkDOM(node, null, {
        enter: function(srcNode, destParent) {
          var destNode = srcNode.cloneNode(false);
          destNode.ownerDocument = doc;
          destNode.parentNode = null;
          if (destParent === null) {
            destRoot = destNode;
          } else {
            destParent.appendChild(destNode);
          }
          var shouldDeep = srcNode.nodeType === ATTRIBUTE_NODE || deep;
          return shouldDeep ? destNode : null;
        }
      });
      return destRoot;
    }
    function cloneNode(doc, node, deep) {
      var destRoot;
      walkDOM(node, null, {
        enter: function(srcNode, destParent) {
          var destNode = new srcNode.constructor(PDC);
          for (var n in srcNode) {
            if (hasOwn(srcNode, n)) {
              var v = srcNode[n];
              if (typeof v != "object") {
                if (v != destNode[n]) {
                  destNode[n] = v;
                }
              }
            }
          }
          if (srcNode.childNodes) {
            destNode.childNodes = new NodeList();
          }
          destNode.ownerDocument = doc;
          var shouldDeep = deep;
          switch (destNode.nodeType) {
            case ELEMENT_NODE:
              var attrs = srcNode.attributes;
              var attrs2 = destNode.attributes = new NamedNodeMap();
              var len = attrs.length;
              attrs2._ownerElement = destNode;
              for (var i = 0; i < len; i++) {
                destNode.setAttributeNode(cloneNode(doc, attrs.item(i), true));
              }
              break;
            case ATTRIBUTE_NODE:
              shouldDeep = true;
          }
          if (destParent !== null) {
            destParent.appendChild(destNode);
          } else {
            destRoot = destNode;
          }
          return shouldDeep ? destNode : null;
        }
      });
      return destRoot;
    }
    function __set__(object, key, value2) {
      object[key] = value2;
    }
    function childrenRefresh(node) {
      var ls = [];
      var child2 = node.firstChild;
      while (child2) {
        if (child2.nodeType === ELEMENT_NODE) {
          ls.push(child2);
        }
        child2 = child2.nextSibling;
      }
      return ls;
    }
    try {
      if (Object.defineProperty) {
        Object.defineProperty(LiveNodeList.prototype, "length", {
          get: function() {
            _updateLiveList(this);
            return this.$$length;
          }
        });
        Object.defineProperty(Node.prototype, "textContent", {
          get: function() {
            if (this.nodeType === ELEMENT_NODE || this.nodeType === DOCUMENT_FRAGMENT_NODE) {
              var buf = [];
              walkDOM(this, null, {
                enter: function(n) {
                  if (n.nodeType === ELEMENT_NODE || n.nodeType === DOCUMENT_FRAGMENT_NODE) {
                    return true;
                  }
                  if (n.nodeType === PROCESSING_INSTRUCTION_NODE || n.nodeType === COMMENT_NODE) {
                    return null;
                  }
                  buf.push(n.nodeValue);
                }
              });
              return buf.join("");
            }
            return this.nodeValue;
          },
          set: function(data) {
            switch (this.nodeType) {
              case ELEMENT_NODE:
              case DOCUMENT_FRAGMENT_NODE:
                while (this.firstChild) {
                  this.removeChild(this.firstChild);
                }
                if (data || String(data)) {
                  this.appendChild(this.ownerDocument.createTextNode(data));
                }
                break;
              default:
                this.data = data;
                this.value = data;
                this.nodeValue = data;
            }
          }
        });
        Object.defineProperty(CharacterData.prototype, "data", {
          get: function() {
            return this._data != null ? this._data : "";
          },
          set: function(v) {
            this._data = v;
            this.length = typeof v === "string" ? v.length : 0;
          }
        });
        Object.defineProperty(CharacterData.prototype, "nodeValue", {
          get: function() {
            return this.data;
          },
          set: function(v) {
            this.data = v;
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(Element.prototype, "children", {
          get: function() {
            return new LiveNodeList(this, childrenRefresh);
          }
        });
        Object.defineProperty(Document.prototype, "children", {
          get: function() {
            return new LiveNodeList(this, childrenRefresh);
          }
        });
        Object.defineProperty(DocumentFragment.prototype, "children", {
          get: function() {
            return new LiveNodeList(this, childrenRefresh);
          }
        });
        __set__ = function(object, key, value2) {
          object["$$" + key] = value2;
        };
      }
    } catch (e) {
    }
    exports._updateLiveList = _updateLiveList;
    exports.Attr = Attr;
    exports.CDATASection = CDATASection;
    exports.CharacterData = CharacterData;
    exports.Comment = Comment;
    exports.Document = Document;
    exports.DocumentFragment = DocumentFragment;
    exports.DocumentType = DocumentType;
    exports.DOMImplementation = DOMImplementation;
    exports.Element = Element;
    exports.Entity = Entity;
    exports.EntityReference = EntityReference;
    exports.LiveNodeList = LiveNodeList;
    exports.NamedNodeMap = NamedNodeMap;
    exports.Node = Node;
    exports.NodeList = NodeList;
    exports.Notation = Notation;
    exports.Text = Text;
    exports.ProcessingInstruction = ProcessingInstruction;
    exports.walkDOM = walkDOM;
    exports.XMLSerializer = XMLSerializer3;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/entities.js
var require_entities = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/entities.js"(exports) {
    "use strict";
    var freeze = require_conventions().freeze;
    exports.XML_ENTITIES = freeze({
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"'
    });
    exports.HTML_ENTITIES = freeze({
      Aacute: "\xC1",
      aacute: "\xE1",
      Abreve: "\u0102",
      abreve: "\u0103",
      ac: "\u223E",
      acd: "\u223F",
      acE: "\u223E\u0333",
      Acirc: "\xC2",
      acirc: "\xE2",
      acute: "\xB4",
      Acy: "\u0410",
      acy: "\u0430",
      AElig: "\xC6",
      aelig: "\xE6",
      af: "\u2061",
      Afr: "\u{1D504}",
      afr: "\u{1D51E}",
      Agrave: "\xC0",
      agrave: "\xE0",
      alefsym: "\u2135",
      aleph: "\u2135",
      Alpha: "\u0391",
      alpha: "\u03B1",
      Amacr: "\u0100",
      amacr: "\u0101",
      amalg: "\u2A3F",
      AMP: "&",
      amp: "&",
      And: "\u2A53",
      and: "\u2227",
      andand: "\u2A55",
      andd: "\u2A5C",
      andslope: "\u2A58",
      andv: "\u2A5A",
      ang: "\u2220",
      ange: "\u29A4",
      angle: "\u2220",
      angmsd: "\u2221",
      angmsdaa: "\u29A8",
      angmsdab: "\u29A9",
      angmsdac: "\u29AA",
      angmsdad: "\u29AB",
      angmsdae: "\u29AC",
      angmsdaf: "\u29AD",
      angmsdag: "\u29AE",
      angmsdah: "\u29AF",
      angrt: "\u221F",
      angrtvb: "\u22BE",
      angrtvbd: "\u299D",
      angsph: "\u2222",
      angst: "\xC5",
      angzarr: "\u237C",
      Aogon: "\u0104",
      aogon: "\u0105",
      Aopf: "\u{1D538}",
      aopf: "\u{1D552}",
      ap: "\u2248",
      apacir: "\u2A6F",
      apE: "\u2A70",
      ape: "\u224A",
      apid: "\u224B",
      apos: "'",
      ApplyFunction: "\u2061",
      approx: "\u2248",
      approxeq: "\u224A",
      Aring: "\xC5",
      aring: "\xE5",
      Ascr: "\u{1D49C}",
      ascr: "\u{1D4B6}",
      Assign: "\u2254",
      ast: "*",
      asymp: "\u2248",
      asympeq: "\u224D",
      Atilde: "\xC3",
      atilde: "\xE3",
      Auml: "\xC4",
      auml: "\xE4",
      awconint: "\u2233",
      awint: "\u2A11",
      backcong: "\u224C",
      backepsilon: "\u03F6",
      backprime: "\u2035",
      backsim: "\u223D",
      backsimeq: "\u22CD",
      Backslash: "\u2216",
      Barv: "\u2AE7",
      barvee: "\u22BD",
      Barwed: "\u2306",
      barwed: "\u2305",
      barwedge: "\u2305",
      bbrk: "\u23B5",
      bbrktbrk: "\u23B6",
      bcong: "\u224C",
      Bcy: "\u0411",
      bcy: "\u0431",
      bdquo: "\u201E",
      becaus: "\u2235",
      Because: "\u2235",
      because: "\u2235",
      bemptyv: "\u29B0",
      bepsi: "\u03F6",
      bernou: "\u212C",
      Bernoullis: "\u212C",
      Beta: "\u0392",
      beta: "\u03B2",
      beth: "\u2136",
      between: "\u226C",
      Bfr: "\u{1D505}",
      bfr: "\u{1D51F}",
      bigcap: "\u22C2",
      bigcirc: "\u25EF",
      bigcup: "\u22C3",
      bigodot: "\u2A00",
      bigoplus: "\u2A01",
      bigotimes: "\u2A02",
      bigsqcup: "\u2A06",
      bigstar: "\u2605",
      bigtriangledown: "\u25BD",
      bigtriangleup: "\u25B3",
      biguplus: "\u2A04",
      bigvee: "\u22C1",
      bigwedge: "\u22C0",
      bkarow: "\u290D",
      blacklozenge: "\u29EB",
      blacksquare: "\u25AA",
      blacktriangle: "\u25B4",
      blacktriangledown: "\u25BE",
      blacktriangleleft: "\u25C2",
      blacktriangleright: "\u25B8",
      blank: "\u2423",
      blk12: "\u2592",
      blk14: "\u2591",
      blk34: "\u2593",
      block: "\u2588",
      bne: "=\u20E5",
      bnequiv: "\u2261\u20E5",
      bNot: "\u2AED",
      bnot: "\u2310",
      Bopf: "\u{1D539}",
      bopf: "\u{1D553}",
      bot: "\u22A5",
      bottom: "\u22A5",
      bowtie: "\u22C8",
      boxbox: "\u29C9",
      boxDL: "\u2557",
      boxDl: "\u2556",
      boxdL: "\u2555",
      boxdl: "\u2510",
      boxDR: "\u2554",
      boxDr: "\u2553",
      boxdR: "\u2552",
      boxdr: "\u250C",
      boxH: "\u2550",
      boxh: "\u2500",
      boxHD: "\u2566",
      boxHd: "\u2564",
      boxhD: "\u2565",
      boxhd: "\u252C",
      boxHU: "\u2569",
      boxHu: "\u2567",
      boxhU: "\u2568",
      boxhu: "\u2534",
      boxminus: "\u229F",
      boxplus: "\u229E",
      boxtimes: "\u22A0",
      boxUL: "\u255D",
      boxUl: "\u255C",
      boxuL: "\u255B",
      boxul: "\u2518",
      boxUR: "\u255A",
      boxUr: "\u2559",
      boxuR: "\u2558",
      boxur: "\u2514",
      boxV: "\u2551",
      boxv: "\u2502",
      boxVH: "\u256C",
      boxVh: "\u256B",
      boxvH: "\u256A",
      boxvh: "\u253C",
      boxVL: "\u2563",
      boxVl: "\u2562",
      boxvL: "\u2561",
      boxvl: "\u2524",
      boxVR: "\u2560",
      boxVr: "\u255F",
      boxvR: "\u255E",
      boxvr: "\u251C",
      bprime: "\u2035",
      Breve: "\u02D8",
      breve: "\u02D8",
      brvbar: "\xA6",
      Bscr: "\u212C",
      bscr: "\u{1D4B7}",
      bsemi: "\u204F",
      bsim: "\u223D",
      bsime: "\u22CD",
      bsol: "\\",
      bsolb: "\u29C5",
      bsolhsub: "\u27C8",
      bull: "\u2022",
      bullet: "\u2022",
      bump: "\u224E",
      bumpE: "\u2AAE",
      bumpe: "\u224F",
      Bumpeq: "\u224E",
      bumpeq: "\u224F",
      Cacute: "\u0106",
      cacute: "\u0107",
      Cap: "\u22D2",
      cap: "\u2229",
      capand: "\u2A44",
      capbrcup: "\u2A49",
      capcap: "\u2A4B",
      capcup: "\u2A47",
      capdot: "\u2A40",
      CapitalDifferentialD: "\u2145",
      caps: "\u2229\uFE00",
      caret: "\u2041",
      caron: "\u02C7",
      Cayleys: "\u212D",
      ccaps: "\u2A4D",
      Ccaron: "\u010C",
      ccaron: "\u010D",
      Ccedil: "\xC7",
      ccedil: "\xE7",
      Ccirc: "\u0108",
      ccirc: "\u0109",
      Cconint: "\u2230",
      ccups: "\u2A4C",
      ccupssm: "\u2A50",
      Cdot: "\u010A",
      cdot: "\u010B",
      cedil: "\xB8",
      Cedilla: "\xB8",
      cemptyv: "\u29B2",
      cent: "\xA2",
      CenterDot: "\xB7",
      centerdot: "\xB7",
      Cfr: "\u212D",
      cfr: "\u{1D520}",
      CHcy: "\u0427",
      chcy: "\u0447",
      check: "\u2713",
      checkmark: "\u2713",
      Chi: "\u03A7",
      chi: "\u03C7",
      cir: "\u25CB",
      circ: "\u02C6",
      circeq: "\u2257",
      circlearrowleft: "\u21BA",
      circlearrowright: "\u21BB",
      circledast: "\u229B",
      circledcirc: "\u229A",
      circleddash: "\u229D",
      CircleDot: "\u2299",
      circledR: "\xAE",
      circledS: "\u24C8",
      CircleMinus: "\u2296",
      CirclePlus: "\u2295",
      CircleTimes: "\u2297",
      cirE: "\u29C3",
      cire: "\u2257",
      cirfnint: "\u2A10",
      cirmid: "\u2AEF",
      cirscir: "\u29C2",
      ClockwiseContourIntegral: "\u2232",
      CloseCurlyDoubleQuote: "\u201D",
      CloseCurlyQuote: "\u2019",
      clubs: "\u2663",
      clubsuit: "\u2663",
      Colon: "\u2237",
      colon: ":",
      Colone: "\u2A74",
      colone: "\u2254",
      coloneq: "\u2254",
      comma: ",",
      commat: "@",
      comp: "\u2201",
      compfn: "\u2218",
      complement: "\u2201",
      complexes: "\u2102",
      cong: "\u2245",
      congdot: "\u2A6D",
      Congruent: "\u2261",
      Conint: "\u222F",
      conint: "\u222E",
      ContourIntegral: "\u222E",
      Copf: "\u2102",
      copf: "\u{1D554}",
      coprod: "\u2210",
      Coproduct: "\u2210",
      COPY: "\xA9",
      copy: "\xA9",
      copysr: "\u2117",
      CounterClockwiseContourIntegral: "\u2233",
      crarr: "\u21B5",
      Cross: "\u2A2F",
      cross: "\u2717",
      Cscr: "\u{1D49E}",
      cscr: "\u{1D4B8}",
      csub: "\u2ACF",
      csube: "\u2AD1",
      csup: "\u2AD0",
      csupe: "\u2AD2",
      ctdot: "\u22EF",
      cudarrl: "\u2938",
      cudarrr: "\u2935",
      cuepr: "\u22DE",
      cuesc: "\u22DF",
      cularr: "\u21B6",
      cularrp: "\u293D",
      Cup: "\u22D3",
      cup: "\u222A",
      cupbrcap: "\u2A48",
      CupCap: "\u224D",
      cupcap: "\u2A46",
      cupcup: "\u2A4A",
      cupdot: "\u228D",
      cupor: "\u2A45",
      cups: "\u222A\uFE00",
      curarr: "\u21B7",
      curarrm: "\u293C",
      curlyeqprec: "\u22DE",
      curlyeqsucc: "\u22DF",
      curlyvee: "\u22CE",
      curlywedge: "\u22CF",
      curren: "\xA4",
      curvearrowleft: "\u21B6",
      curvearrowright: "\u21B7",
      cuvee: "\u22CE",
      cuwed: "\u22CF",
      cwconint: "\u2232",
      cwint: "\u2231",
      cylcty: "\u232D",
      Dagger: "\u2021",
      dagger: "\u2020",
      daleth: "\u2138",
      Darr: "\u21A1",
      dArr: "\u21D3",
      darr: "\u2193",
      dash: "\u2010",
      Dashv: "\u2AE4",
      dashv: "\u22A3",
      dbkarow: "\u290F",
      dblac: "\u02DD",
      Dcaron: "\u010E",
      dcaron: "\u010F",
      Dcy: "\u0414",
      dcy: "\u0434",
      DD: "\u2145",
      dd: "\u2146",
      ddagger: "\u2021",
      ddarr: "\u21CA",
      DDotrahd: "\u2911",
      ddotseq: "\u2A77",
      deg: "\xB0",
      Del: "\u2207",
      Delta: "\u0394",
      delta: "\u03B4",
      demptyv: "\u29B1",
      dfisht: "\u297F",
      Dfr: "\u{1D507}",
      dfr: "\u{1D521}",
      dHar: "\u2965",
      dharl: "\u21C3",
      dharr: "\u21C2",
      DiacriticalAcute: "\xB4",
      DiacriticalDot: "\u02D9",
      DiacriticalDoubleAcute: "\u02DD",
      DiacriticalGrave: "`",
      DiacriticalTilde: "\u02DC",
      diam: "\u22C4",
      Diamond: "\u22C4",
      diamond: "\u22C4",
      diamondsuit: "\u2666",
      diams: "\u2666",
      die: "\xA8",
      DifferentialD: "\u2146",
      digamma: "\u03DD",
      disin: "\u22F2",
      div: "\xF7",
      divide: "\xF7",
      divideontimes: "\u22C7",
      divonx: "\u22C7",
      DJcy: "\u0402",
      djcy: "\u0452",
      dlcorn: "\u231E",
      dlcrop: "\u230D",
      dollar: "$",
      Dopf: "\u{1D53B}",
      dopf: "\u{1D555}",
      Dot: "\xA8",
      dot: "\u02D9",
      DotDot: "\u20DC",
      doteq: "\u2250",
      doteqdot: "\u2251",
      DotEqual: "\u2250",
      dotminus: "\u2238",
      dotplus: "\u2214",
      dotsquare: "\u22A1",
      doublebarwedge: "\u2306",
      DoubleContourIntegral: "\u222F",
      DoubleDot: "\xA8",
      DoubleDownArrow: "\u21D3",
      DoubleLeftArrow: "\u21D0",
      DoubleLeftRightArrow: "\u21D4",
      DoubleLeftTee: "\u2AE4",
      DoubleLongLeftArrow: "\u27F8",
      DoubleLongLeftRightArrow: "\u27FA",
      DoubleLongRightArrow: "\u27F9",
      DoubleRightArrow: "\u21D2",
      DoubleRightTee: "\u22A8",
      DoubleUpArrow: "\u21D1",
      DoubleUpDownArrow: "\u21D5",
      DoubleVerticalBar: "\u2225",
      DownArrow: "\u2193",
      Downarrow: "\u21D3",
      downarrow: "\u2193",
      DownArrowBar: "\u2913",
      DownArrowUpArrow: "\u21F5",
      DownBreve: "\u0311",
      downdownarrows: "\u21CA",
      downharpoonleft: "\u21C3",
      downharpoonright: "\u21C2",
      DownLeftRightVector: "\u2950",
      DownLeftTeeVector: "\u295E",
      DownLeftVector: "\u21BD",
      DownLeftVectorBar: "\u2956",
      DownRightTeeVector: "\u295F",
      DownRightVector: "\u21C1",
      DownRightVectorBar: "\u2957",
      DownTee: "\u22A4",
      DownTeeArrow: "\u21A7",
      drbkarow: "\u2910",
      drcorn: "\u231F",
      drcrop: "\u230C",
      Dscr: "\u{1D49F}",
      dscr: "\u{1D4B9}",
      DScy: "\u0405",
      dscy: "\u0455",
      dsol: "\u29F6",
      Dstrok: "\u0110",
      dstrok: "\u0111",
      dtdot: "\u22F1",
      dtri: "\u25BF",
      dtrif: "\u25BE",
      duarr: "\u21F5",
      duhar: "\u296F",
      dwangle: "\u29A6",
      DZcy: "\u040F",
      dzcy: "\u045F",
      dzigrarr: "\u27FF",
      Eacute: "\xC9",
      eacute: "\xE9",
      easter: "\u2A6E",
      Ecaron: "\u011A",
      ecaron: "\u011B",
      ecir: "\u2256",
      Ecirc: "\xCA",
      ecirc: "\xEA",
      ecolon: "\u2255",
      Ecy: "\u042D",
      ecy: "\u044D",
      eDDot: "\u2A77",
      Edot: "\u0116",
      eDot: "\u2251",
      edot: "\u0117",
      ee: "\u2147",
      efDot: "\u2252",
      Efr: "\u{1D508}",
      efr: "\u{1D522}",
      eg: "\u2A9A",
      Egrave: "\xC8",
      egrave: "\xE8",
      egs: "\u2A96",
      egsdot: "\u2A98",
      el: "\u2A99",
      Element: "\u2208",
      elinters: "\u23E7",
      ell: "\u2113",
      els: "\u2A95",
      elsdot: "\u2A97",
      Emacr: "\u0112",
      emacr: "\u0113",
      empty: "\u2205",
      emptyset: "\u2205",
      EmptySmallSquare: "\u25FB",
      emptyv: "\u2205",
      EmptyVerySmallSquare: "\u25AB",
      emsp: "\u2003",
      emsp13: "\u2004",
      emsp14: "\u2005",
      ENG: "\u014A",
      eng: "\u014B",
      ensp: "\u2002",
      Eogon: "\u0118",
      eogon: "\u0119",
      Eopf: "\u{1D53C}",
      eopf: "\u{1D556}",
      epar: "\u22D5",
      eparsl: "\u29E3",
      eplus: "\u2A71",
      epsi: "\u03B5",
      Epsilon: "\u0395",
      epsilon: "\u03B5",
      epsiv: "\u03F5",
      eqcirc: "\u2256",
      eqcolon: "\u2255",
      eqsim: "\u2242",
      eqslantgtr: "\u2A96",
      eqslantless: "\u2A95",
      Equal: "\u2A75",
      equals: "=",
      EqualTilde: "\u2242",
      equest: "\u225F",
      Equilibrium: "\u21CC",
      equiv: "\u2261",
      equivDD: "\u2A78",
      eqvparsl: "\u29E5",
      erarr: "\u2971",
      erDot: "\u2253",
      Escr: "\u2130",
      escr: "\u212F",
      esdot: "\u2250",
      Esim: "\u2A73",
      esim: "\u2242",
      Eta: "\u0397",
      eta: "\u03B7",
      ETH: "\xD0",
      eth: "\xF0",
      Euml: "\xCB",
      euml: "\xEB",
      euro: "\u20AC",
      excl: "!",
      exist: "\u2203",
      Exists: "\u2203",
      expectation: "\u2130",
      ExponentialE: "\u2147",
      exponentiale: "\u2147",
      fallingdotseq: "\u2252",
      Fcy: "\u0424",
      fcy: "\u0444",
      female: "\u2640",
      ffilig: "\uFB03",
      fflig: "\uFB00",
      ffllig: "\uFB04",
      Ffr: "\u{1D509}",
      ffr: "\u{1D523}",
      filig: "\uFB01",
      FilledSmallSquare: "\u25FC",
      FilledVerySmallSquare: "\u25AA",
      fjlig: "fj",
      flat: "\u266D",
      fllig: "\uFB02",
      fltns: "\u25B1",
      fnof: "\u0192",
      Fopf: "\u{1D53D}",
      fopf: "\u{1D557}",
      ForAll: "\u2200",
      forall: "\u2200",
      fork: "\u22D4",
      forkv: "\u2AD9",
      Fouriertrf: "\u2131",
      fpartint: "\u2A0D",
      frac12: "\xBD",
      frac13: "\u2153",
      frac14: "\xBC",
      frac15: "\u2155",
      frac16: "\u2159",
      frac18: "\u215B",
      frac23: "\u2154",
      frac25: "\u2156",
      frac34: "\xBE",
      frac35: "\u2157",
      frac38: "\u215C",
      frac45: "\u2158",
      frac56: "\u215A",
      frac58: "\u215D",
      frac78: "\u215E",
      frasl: "\u2044",
      frown: "\u2322",
      Fscr: "\u2131",
      fscr: "\u{1D4BB}",
      gacute: "\u01F5",
      Gamma: "\u0393",
      gamma: "\u03B3",
      Gammad: "\u03DC",
      gammad: "\u03DD",
      gap: "\u2A86",
      Gbreve: "\u011E",
      gbreve: "\u011F",
      Gcedil: "\u0122",
      Gcirc: "\u011C",
      gcirc: "\u011D",
      Gcy: "\u0413",
      gcy: "\u0433",
      Gdot: "\u0120",
      gdot: "\u0121",
      gE: "\u2267",
      ge: "\u2265",
      gEl: "\u2A8C",
      gel: "\u22DB",
      geq: "\u2265",
      geqq: "\u2267",
      geqslant: "\u2A7E",
      ges: "\u2A7E",
      gescc: "\u2AA9",
      gesdot: "\u2A80",
      gesdoto: "\u2A82",
      gesdotol: "\u2A84",
      gesl: "\u22DB\uFE00",
      gesles: "\u2A94",
      Gfr: "\u{1D50A}",
      gfr: "\u{1D524}",
      Gg: "\u22D9",
      gg: "\u226B",
      ggg: "\u22D9",
      gimel: "\u2137",
      GJcy: "\u0403",
      gjcy: "\u0453",
      gl: "\u2277",
      gla: "\u2AA5",
      glE: "\u2A92",
      glj: "\u2AA4",
      gnap: "\u2A8A",
      gnapprox: "\u2A8A",
      gnE: "\u2269",
      gne: "\u2A88",
      gneq: "\u2A88",
      gneqq: "\u2269",
      gnsim: "\u22E7",
      Gopf: "\u{1D53E}",
      gopf: "\u{1D558}",
      grave: "`",
      GreaterEqual: "\u2265",
      GreaterEqualLess: "\u22DB",
      GreaterFullEqual: "\u2267",
      GreaterGreater: "\u2AA2",
      GreaterLess: "\u2277",
      GreaterSlantEqual: "\u2A7E",
      GreaterTilde: "\u2273",
      Gscr: "\u{1D4A2}",
      gscr: "\u210A",
      gsim: "\u2273",
      gsime: "\u2A8E",
      gsiml: "\u2A90",
      Gt: "\u226B",
      GT: ">",
      gt: ">",
      gtcc: "\u2AA7",
      gtcir: "\u2A7A",
      gtdot: "\u22D7",
      gtlPar: "\u2995",
      gtquest: "\u2A7C",
      gtrapprox: "\u2A86",
      gtrarr: "\u2978",
      gtrdot: "\u22D7",
      gtreqless: "\u22DB",
      gtreqqless: "\u2A8C",
      gtrless: "\u2277",
      gtrsim: "\u2273",
      gvertneqq: "\u2269\uFE00",
      gvnE: "\u2269\uFE00",
      Hacek: "\u02C7",
      hairsp: "\u200A",
      half: "\xBD",
      hamilt: "\u210B",
      HARDcy: "\u042A",
      hardcy: "\u044A",
      hArr: "\u21D4",
      harr: "\u2194",
      harrcir: "\u2948",
      harrw: "\u21AD",
      Hat: "^",
      hbar: "\u210F",
      Hcirc: "\u0124",
      hcirc: "\u0125",
      hearts: "\u2665",
      heartsuit: "\u2665",
      hellip: "\u2026",
      hercon: "\u22B9",
      Hfr: "\u210C",
      hfr: "\u{1D525}",
      HilbertSpace: "\u210B",
      hksearow: "\u2925",
      hkswarow: "\u2926",
      hoarr: "\u21FF",
      homtht: "\u223B",
      hookleftarrow: "\u21A9",
      hookrightarrow: "\u21AA",
      Hopf: "\u210D",
      hopf: "\u{1D559}",
      horbar: "\u2015",
      HorizontalLine: "\u2500",
      Hscr: "\u210B",
      hscr: "\u{1D4BD}",
      hslash: "\u210F",
      Hstrok: "\u0126",
      hstrok: "\u0127",
      HumpDownHump: "\u224E",
      HumpEqual: "\u224F",
      hybull: "\u2043",
      hyphen: "\u2010",
      Iacute: "\xCD",
      iacute: "\xED",
      ic: "\u2063",
      Icirc: "\xCE",
      icirc: "\xEE",
      Icy: "\u0418",
      icy: "\u0438",
      Idot: "\u0130",
      IEcy: "\u0415",
      iecy: "\u0435",
      iexcl: "\xA1",
      iff: "\u21D4",
      Ifr: "\u2111",
      ifr: "\u{1D526}",
      Igrave: "\xCC",
      igrave: "\xEC",
      ii: "\u2148",
      iiiint: "\u2A0C",
      iiint: "\u222D",
      iinfin: "\u29DC",
      iiota: "\u2129",
      IJlig: "\u0132",
      ijlig: "\u0133",
      Im: "\u2111",
      Imacr: "\u012A",
      imacr: "\u012B",
      image: "\u2111",
      ImaginaryI: "\u2148",
      imagline: "\u2110",
      imagpart: "\u2111",
      imath: "\u0131",
      imof: "\u22B7",
      imped: "\u01B5",
      Implies: "\u21D2",
      in: "\u2208",
      incare: "\u2105",
      infin: "\u221E",
      infintie: "\u29DD",
      inodot: "\u0131",
      Int: "\u222C",
      int: "\u222B",
      intcal: "\u22BA",
      integers: "\u2124",
      Integral: "\u222B",
      intercal: "\u22BA",
      Intersection: "\u22C2",
      intlarhk: "\u2A17",
      intprod: "\u2A3C",
      InvisibleComma: "\u2063",
      InvisibleTimes: "\u2062",
      IOcy: "\u0401",
      iocy: "\u0451",
      Iogon: "\u012E",
      iogon: "\u012F",
      Iopf: "\u{1D540}",
      iopf: "\u{1D55A}",
      Iota: "\u0399",
      iota: "\u03B9",
      iprod: "\u2A3C",
      iquest: "\xBF",
      Iscr: "\u2110",
      iscr: "\u{1D4BE}",
      isin: "\u2208",
      isindot: "\u22F5",
      isinE: "\u22F9",
      isins: "\u22F4",
      isinsv: "\u22F3",
      isinv: "\u2208",
      it: "\u2062",
      Itilde: "\u0128",
      itilde: "\u0129",
      Iukcy: "\u0406",
      iukcy: "\u0456",
      Iuml: "\xCF",
      iuml: "\xEF",
      Jcirc: "\u0134",
      jcirc: "\u0135",
      Jcy: "\u0419",
      jcy: "\u0439",
      Jfr: "\u{1D50D}",
      jfr: "\u{1D527}",
      jmath: "\u0237",
      Jopf: "\u{1D541}",
      jopf: "\u{1D55B}",
      Jscr: "\u{1D4A5}",
      jscr: "\u{1D4BF}",
      Jsercy: "\u0408",
      jsercy: "\u0458",
      Jukcy: "\u0404",
      jukcy: "\u0454",
      Kappa: "\u039A",
      kappa: "\u03BA",
      kappav: "\u03F0",
      Kcedil: "\u0136",
      kcedil: "\u0137",
      Kcy: "\u041A",
      kcy: "\u043A",
      Kfr: "\u{1D50E}",
      kfr: "\u{1D528}",
      kgreen: "\u0138",
      KHcy: "\u0425",
      khcy: "\u0445",
      KJcy: "\u040C",
      kjcy: "\u045C",
      Kopf: "\u{1D542}",
      kopf: "\u{1D55C}",
      Kscr: "\u{1D4A6}",
      kscr: "\u{1D4C0}",
      lAarr: "\u21DA",
      Lacute: "\u0139",
      lacute: "\u013A",
      laemptyv: "\u29B4",
      lagran: "\u2112",
      Lambda: "\u039B",
      lambda: "\u03BB",
      Lang: "\u27EA",
      lang: "\u27E8",
      langd: "\u2991",
      langle: "\u27E8",
      lap: "\u2A85",
      Laplacetrf: "\u2112",
      laquo: "\xAB",
      Larr: "\u219E",
      lArr: "\u21D0",
      larr: "\u2190",
      larrb: "\u21E4",
      larrbfs: "\u291F",
      larrfs: "\u291D",
      larrhk: "\u21A9",
      larrlp: "\u21AB",
      larrpl: "\u2939",
      larrsim: "\u2973",
      larrtl: "\u21A2",
      lat: "\u2AAB",
      lAtail: "\u291B",
      latail: "\u2919",
      late: "\u2AAD",
      lates: "\u2AAD\uFE00",
      lBarr: "\u290E",
      lbarr: "\u290C",
      lbbrk: "\u2772",
      lbrace: "{",
      lbrack: "[",
      lbrke: "\u298B",
      lbrksld: "\u298F",
      lbrkslu: "\u298D",
      Lcaron: "\u013D",
      lcaron: "\u013E",
      Lcedil: "\u013B",
      lcedil: "\u013C",
      lceil: "\u2308",
      lcub: "{",
      Lcy: "\u041B",
      lcy: "\u043B",
      ldca: "\u2936",
      ldquo: "\u201C",
      ldquor: "\u201E",
      ldrdhar: "\u2967",
      ldrushar: "\u294B",
      ldsh: "\u21B2",
      lE: "\u2266",
      le: "\u2264",
      LeftAngleBracket: "\u27E8",
      LeftArrow: "\u2190",
      Leftarrow: "\u21D0",
      leftarrow: "\u2190",
      LeftArrowBar: "\u21E4",
      LeftArrowRightArrow: "\u21C6",
      leftarrowtail: "\u21A2",
      LeftCeiling: "\u2308",
      LeftDoubleBracket: "\u27E6",
      LeftDownTeeVector: "\u2961",
      LeftDownVector: "\u21C3",
      LeftDownVectorBar: "\u2959",
      LeftFloor: "\u230A",
      leftharpoondown: "\u21BD",
      leftharpoonup: "\u21BC",
      leftleftarrows: "\u21C7",
      LeftRightArrow: "\u2194",
      Leftrightarrow: "\u21D4",
      leftrightarrow: "\u2194",
      leftrightarrows: "\u21C6",
      leftrightharpoons: "\u21CB",
      leftrightsquigarrow: "\u21AD",
      LeftRightVector: "\u294E",
      LeftTee: "\u22A3",
      LeftTeeArrow: "\u21A4",
      LeftTeeVector: "\u295A",
      leftthreetimes: "\u22CB",
      LeftTriangle: "\u22B2",
      LeftTriangleBar: "\u29CF",
      LeftTriangleEqual: "\u22B4",
      LeftUpDownVector: "\u2951",
      LeftUpTeeVector: "\u2960",
      LeftUpVector: "\u21BF",
      LeftUpVectorBar: "\u2958",
      LeftVector: "\u21BC",
      LeftVectorBar: "\u2952",
      lEg: "\u2A8B",
      leg: "\u22DA",
      leq: "\u2264",
      leqq: "\u2266",
      leqslant: "\u2A7D",
      les: "\u2A7D",
      lescc: "\u2AA8",
      lesdot: "\u2A7F",
      lesdoto: "\u2A81",
      lesdotor: "\u2A83",
      lesg: "\u22DA\uFE00",
      lesges: "\u2A93",
      lessapprox: "\u2A85",
      lessdot: "\u22D6",
      lesseqgtr: "\u22DA",
      lesseqqgtr: "\u2A8B",
      LessEqualGreater: "\u22DA",
      LessFullEqual: "\u2266",
      LessGreater: "\u2276",
      lessgtr: "\u2276",
      LessLess: "\u2AA1",
      lesssim: "\u2272",
      LessSlantEqual: "\u2A7D",
      LessTilde: "\u2272",
      lfisht: "\u297C",
      lfloor: "\u230A",
      Lfr: "\u{1D50F}",
      lfr: "\u{1D529}",
      lg: "\u2276",
      lgE: "\u2A91",
      lHar: "\u2962",
      lhard: "\u21BD",
      lharu: "\u21BC",
      lharul: "\u296A",
      lhblk: "\u2584",
      LJcy: "\u0409",
      ljcy: "\u0459",
      Ll: "\u22D8",
      ll: "\u226A",
      llarr: "\u21C7",
      llcorner: "\u231E",
      Lleftarrow: "\u21DA",
      llhard: "\u296B",
      lltri: "\u25FA",
      Lmidot: "\u013F",
      lmidot: "\u0140",
      lmoust: "\u23B0",
      lmoustache: "\u23B0",
      lnap: "\u2A89",
      lnapprox: "\u2A89",
      lnE: "\u2268",
      lne: "\u2A87",
      lneq: "\u2A87",
      lneqq: "\u2268",
      lnsim: "\u22E6",
      loang: "\u27EC",
      loarr: "\u21FD",
      lobrk: "\u27E6",
      LongLeftArrow: "\u27F5",
      Longleftarrow: "\u27F8",
      longleftarrow: "\u27F5",
      LongLeftRightArrow: "\u27F7",
      Longleftrightarrow: "\u27FA",
      longleftrightarrow: "\u27F7",
      longmapsto: "\u27FC",
      LongRightArrow: "\u27F6",
      Longrightarrow: "\u27F9",
      longrightarrow: "\u27F6",
      looparrowleft: "\u21AB",
      looparrowright: "\u21AC",
      lopar: "\u2985",
      Lopf: "\u{1D543}",
      lopf: "\u{1D55D}",
      loplus: "\u2A2D",
      lotimes: "\u2A34",
      lowast: "\u2217",
      lowbar: "_",
      LowerLeftArrow: "\u2199",
      LowerRightArrow: "\u2198",
      loz: "\u25CA",
      lozenge: "\u25CA",
      lozf: "\u29EB",
      lpar: "(",
      lparlt: "\u2993",
      lrarr: "\u21C6",
      lrcorner: "\u231F",
      lrhar: "\u21CB",
      lrhard: "\u296D",
      lrm: "\u200E",
      lrtri: "\u22BF",
      lsaquo: "\u2039",
      Lscr: "\u2112",
      lscr: "\u{1D4C1}",
      Lsh: "\u21B0",
      lsh: "\u21B0",
      lsim: "\u2272",
      lsime: "\u2A8D",
      lsimg: "\u2A8F",
      lsqb: "[",
      lsquo: "\u2018",
      lsquor: "\u201A",
      Lstrok: "\u0141",
      lstrok: "\u0142",
      Lt: "\u226A",
      LT: "<",
      lt: "<",
      ltcc: "\u2AA6",
      ltcir: "\u2A79",
      ltdot: "\u22D6",
      lthree: "\u22CB",
      ltimes: "\u22C9",
      ltlarr: "\u2976",
      ltquest: "\u2A7B",
      ltri: "\u25C3",
      ltrie: "\u22B4",
      ltrif: "\u25C2",
      ltrPar: "\u2996",
      lurdshar: "\u294A",
      luruhar: "\u2966",
      lvertneqq: "\u2268\uFE00",
      lvnE: "\u2268\uFE00",
      macr: "\xAF",
      male: "\u2642",
      malt: "\u2720",
      maltese: "\u2720",
      Map: "\u2905",
      map: "\u21A6",
      mapsto: "\u21A6",
      mapstodown: "\u21A7",
      mapstoleft: "\u21A4",
      mapstoup: "\u21A5",
      marker: "\u25AE",
      mcomma: "\u2A29",
      Mcy: "\u041C",
      mcy: "\u043C",
      mdash: "\u2014",
      mDDot: "\u223A",
      measuredangle: "\u2221",
      MediumSpace: "\u205F",
      Mellintrf: "\u2133",
      Mfr: "\u{1D510}",
      mfr: "\u{1D52A}",
      mho: "\u2127",
      micro: "\xB5",
      mid: "\u2223",
      midast: "*",
      midcir: "\u2AF0",
      middot: "\xB7",
      minus: "\u2212",
      minusb: "\u229F",
      minusd: "\u2238",
      minusdu: "\u2A2A",
      MinusPlus: "\u2213",
      mlcp: "\u2ADB",
      mldr: "\u2026",
      mnplus: "\u2213",
      models: "\u22A7",
      Mopf: "\u{1D544}",
      mopf: "\u{1D55E}",
      mp: "\u2213",
      Mscr: "\u2133",
      mscr: "\u{1D4C2}",
      mstpos: "\u223E",
      Mu: "\u039C",
      mu: "\u03BC",
      multimap: "\u22B8",
      mumap: "\u22B8",
      nabla: "\u2207",
      Nacute: "\u0143",
      nacute: "\u0144",
      nang: "\u2220\u20D2",
      nap: "\u2249",
      napE: "\u2A70\u0338",
      napid: "\u224B\u0338",
      napos: "\u0149",
      napprox: "\u2249",
      natur: "\u266E",
      natural: "\u266E",
      naturals: "\u2115",
      nbsp: "\xA0",
      nbump: "\u224E\u0338",
      nbumpe: "\u224F\u0338",
      ncap: "\u2A43",
      Ncaron: "\u0147",
      ncaron: "\u0148",
      Ncedil: "\u0145",
      ncedil: "\u0146",
      ncong: "\u2247",
      ncongdot: "\u2A6D\u0338",
      ncup: "\u2A42",
      Ncy: "\u041D",
      ncy: "\u043D",
      ndash: "\u2013",
      ne: "\u2260",
      nearhk: "\u2924",
      neArr: "\u21D7",
      nearr: "\u2197",
      nearrow: "\u2197",
      nedot: "\u2250\u0338",
      NegativeMediumSpace: "\u200B",
      NegativeThickSpace: "\u200B",
      NegativeThinSpace: "\u200B",
      NegativeVeryThinSpace: "\u200B",
      nequiv: "\u2262",
      nesear: "\u2928",
      nesim: "\u2242\u0338",
      NestedGreaterGreater: "\u226B",
      NestedLessLess: "\u226A",
      NewLine: "\n",
      nexist: "\u2204",
      nexists: "\u2204",
      Nfr: "\u{1D511}",
      nfr: "\u{1D52B}",
      ngE: "\u2267\u0338",
      nge: "\u2271",
      ngeq: "\u2271",
      ngeqq: "\u2267\u0338",
      ngeqslant: "\u2A7E\u0338",
      nges: "\u2A7E\u0338",
      nGg: "\u22D9\u0338",
      ngsim: "\u2275",
      nGt: "\u226B\u20D2",
      ngt: "\u226F",
      ngtr: "\u226F",
      nGtv: "\u226B\u0338",
      nhArr: "\u21CE",
      nharr: "\u21AE",
      nhpar: "\u2AF2",
      ni: "\u220B",
      nis: "\u22FC",
      nisd: "\u22FA",
      niv: "\u220B",
      NJcy: "\u040A",
      njcy: "\u045A",
      nlArr: "\u21CD",
      nlarr: "\u219A",
      nldr: "\u2025",
      nlE: "\u2266\u0338",
      nle: "\u2270",
      nLeftarrow: "\u21CD",
      nleftarrow: "\u219A",
      nLeftrightarrow: "\u21CE",
      nleftrightarrow: "\u21AE",
      nleq: "\u2270",
      nleqq: "\u2266\u0338",
      nleqslant: "\u2A7D\u0338",
      nles: "\u2A7D\u0338",
      nless: "\u226E",
      nLl: "\u22D8\u0338",
      nlsim: "\u2274",
      nLt: "\u226A\u20D2",
      nlt: "\u226E",
      nltri: "\u22EA",
      nltrie: "\u22EC",
      nLtv: "\u226A\u0338",
      nmid: "\u2224",
      NoBreak: "\u2060",
      NonBreakingSpace: "\xA0",
      Nopf: "\u2115",
      nopf: "\u{1D55F}",
      Not: "\u2AEC",
      not: "\xAC",
      NotCongruent: "\u2262",
      NotCupCap: "\u226D",
      NotDoubleVerticalBar: "\u2226",
      NotElement: "\u2209",
      NotEqual: "\u2260",
      NotEqualTilde: "\u2242\u0338",
      NotExists: "\u2204",
      NotGreater: "\u226F",
      NotGreaterEqual: "\u2271",
      NotGreaterFullEqual: "\u2267\u0338",
      NotGreaterGreater: "\u226B\u0338",
      NotGreaterLess: "\u2279",
      NotGreaterSlantEqual: "\u2A7E\u0338",
      NotGreaterTilde: "\u2275",
      NotHumpDownHump: "\u224E\u0338",
      NotHumpEqual: "\u224F\u0338",
      notin: "\u2209",
      notindot: "\u22F5\u0338",
      notinE: "\u22F9\u0338",
      notinva: "\u2209",
      notinvb: "\u22F7",
      notinvc: "\u22F6",
      NotLeftTriangle: "\u22EA",
      NotLeftTriangleBar: "\u29CF\u0338",
      NotLeftTriangleEqual: "\u22EC",
      NotLess: "\u226E",
      NotLessEqual: "\u2270",
      NotLessGreater: "\u2278",
      NotLessLess: "\u226A\u0338",
      NotLessSlantEqual: "\u2A7D\u0338",
      NotLessTilde: "\u2274",
      NotNestedGreaterGreater: "\u2AA2\u0338",
      NotNestedLessLess: "\u2AA1\u0338",
      notni: "\u220C",
      notniva: "\u220C",
      notnivb: "\u22FE",
      notnivc: "\u22FD",
      NotPrecedes: "\u2280",
      NotPrecedesEqual: "\u2AAF\u0338",
      NotPrecedesSlantEqual: "\u22E0",
      NotReverseElement: "\u220C",
      NotRightTriangle: "\u22EB",
      NotRightTriangleBar: "\u29D0\u0338",
      NotRightTriangleEqual: "\u22ED",
      NotSquareSubset: "\u228F\u0338",
      NotSquareSubsetEqual: "\u22E2",
      NotSquareSuperset: "\u2290\u0338",
      NotSquareSupersetEqual: "\u22E3",
      NotSubset: "\u2282\u20D2",
      NotSubsetEqual: "\u2288",
      NotSucceeds: "\u2281",
      NotSucceedsEqual: "\u2AB0\u0338",
      NotSucceedsSlantEqual: "\u22E1",
      NotSucceedsTilde: "\u227F\u0338",
      NotSuperset: "\u2283\u20D2",
      NotSupersetEqual: "\u2289",
      NotTilde: "\u2241",
      NotTildeEqual: "\u2244",
      NotTildeFullEqual: "\u2247",
      NotTildeTilde: "\u2249",
      NotVerticalBar: "\u2224",
      npar: "\u2226",
      nparallel: "\u2226",
      nparsl: "\u2AFD\u20E5",
      npart: "\u2202\u0338",
      npolint: "\u2A14",
      npr: "\u2280",
      nprcue: "\u22E0",
      npre: "\u2AAF\u0338",
      nprec: "\u2280",
      npreceq: "\u2AAF\u0338",
      nrArr: "\u21CF",
      nrarr: "\u219B",
      nrarrc: "\u2933\u0338",
      nrarrw: "\u219D\u0338",
      nRightarrow: "\u21CF",
      nrightarrow: "\u219B",
      nrtri: "\u22EB",
      nrtrie: "\u22ED",
      nsc: "\u2281",
      nsccue: "\u22E1",
      nsce: "\u2AB0\u0338",
      Nscr: "\u{1D4A9}",
      nscr: "\u{1D4C3}",
      nshortmid: "\u2224",
      nshortparallel: "\u2226",
      nsim: "\u2241",
      nsime: "\u2244",
      nsimeq: "\u2244",
      nsmid: "\u2224",
      nspar: "\u2226",
      nsqsube: "\u22E2",
      nsqsupe: "\u22E3",
      nsub: "\u2284",
      nsubE: "\u2AC5\u0338",
      nsube: "\u2288",
      nsubset: "\u2282\u20D2",
      nsubseteq: "\u2288",
      nsubseteqq: "\u2AC5\u0338",
      nsucc: "\u2281",
      nsucceq: "\u2AB0\u0338",
      nsup: "\u2285",
      nsupE: "\u2AC6\u0338",
      nsupe: "\u2289",
      nsupset: "\u2283\u20D2",
      nsupseteq: "\u2289",
      nsupseteqq: "\u2AC6\u0338",
      ntgl: "\u2279",
      Ntilde: "\xD1",
      ntilde: "\xF1",
      ntlg: "\u2278",
      ntriangleleft: "\u22EA",
      ntrianglelefteq: "\u22EC",
      ntriangleright: "\u22EB",
      ntrianglerighteq: "\u22ED",
      Nu: "\u039D",
      nu: "\u03BD",
      num: "#",
      numero: "\u2116",
      numsp: "\u2007",
      nvap: "\u224D\u20D2",
      nVDash: "\u22AF",
      nVdash: "\u22AE",
      nvDash: "\u22AD",
      nvdash: "\u22AC",
      nvge: "\u2265\u20D2",
      nvgt: ">\u20D2",
      nvHarr: "\u2904",
      nvinfin: "\u29DE",
      nvlArr: "\u2902",
      nvle: "\u2264\u20D2",
      nvlt: "<\u20D2",
      nvltrie: "\u22B4\u20D2",
      nvrArr: "\u2903",
      nvrtrie: "\u22B5\u20D2",
      nvsim: "\u223C\u20D2",
      nwarhk: "\u2923",
      nwArr: "\u21D6",
      nwarr: "\u2196",
      nwarrow: "\u2196",
      nwnear: "\u2927",
      Oacute: "\xD3",
      oacute: "\xF3",
      oast: "\u229B",
      ocir: "\u229A",
      Ocirc: "\xD4",
      ocirc: "\xF4",
      Ocy: "\u041E",
      ocy: "\u043E",
      odash: "\u229D",
      Odblac: "\u0150",
      odblac: "\u0151",
      odiv: "\u2A38",
      odot: "\u2299",
      odsold: "\u29BC",
      OElig: "\u0152",
      oelig: "\u0153",
      ofcir: "\u29BF",
      Ofr: "\u{1D512}",
      ofr: "\u{1D52C}",
      ogon: "\u02DB",
      Ograve: "\xD2",
      ograve: "\xF2",
      ogt: "\u29C1",
      ohbar: "\u29B5",
      ohm: "\u03A9",
      oint: "\u222E",
      olarr: "\u21BA",
      olcir: "\u29BE",
      olcross: "\u29BB",
      oline: "\u203E",
      olt: "\u29C0",
      Omacr: "\u014C",
      omacr: "\u014D",
      Omega: "\u03A9",
      omega: "\u03C9",
      Omicron: "\u039F",
      omicron: "\u03BF",
      omid: "\u29B6",
      ominus: "\u2296",
      Oopf: "\u{1D546}",
      oopf: "\u{1D560}",
      opar: "\u29B7",
      OpenCurlyDoubleQuote: "\u201C",
      OpenCurlyQuote: "\u2018",
      operp: "\u29B9",
      oplus: "\u2295",
      Or: "\u2A54",
      or: "\u2228",
      orarr: "\u21BB",
      ord: "\u2A5D",
      order: "\u2134",
      orderof: "\u2134",
      ordf: "\xAA",
      ordm: "\xBA",
      origof: "\u22B6",
      oror: "\u2A56",
      orslope: "\u2A57",
      orv: "\u2A5B",
      oS: "\u24C8",
      Oscr: "\u{1D4AA}",
      oscr: "\u2134",
      Oslash: "\xD8",
      oslash: "\xF8",
      osol: "\u2298",
      Otilde: "\xD5",
      otilde: "\xF5",
      Otimes: "\u2A37",
      otimes: "\u2297",
      otimesas: "\u2A36",
      Ouml: "\xD6",
      ouml: "\xF6",
      ovbar: "\u233D",
      OverBar: "\u203E",
      OverBrace: "\u23DE",
      OverBracket: "\u23B4",
      OverParenthesis: "\u23DC",
      par: "\u2225",
      para: "\xB6",
      parallel: "\u2225",
      parsim: "\u2AF3",
      parsl: "\u2AFD",
      part: "\u2202",
      PartialD: "\u2202",
      Pcy: "\u041F",
      pcy: "\u043F",
      percnt: "%",
      period: ".",
      permil: "\u2030",
      perp: "\u22A5",
      pertenk: "\u2031",
      Pfr: "\u{1D513}",
      pfr: "\u{1D52D}",
      Phi: "\u03A6",
      phi: "\u03C6",
      phiv: "\u03D5",
      phmmat: "\u2133",
      phone: "\u260E",
      Pi: "\u03A0",
      pi: "\u03C0",
      pitchfork: "\u22D4",
      piv: "\u03D6",
      planck: "\u210F",
      planckh: "\u210E",
      plankv: "\u210F",
      plus: "+",
      plusacir: "\u2A23",
      plusb: "\u229E",
      pluscir: "\u2A22",
      plusdo: "\u2214",
      plusdu: "\u2A25",
      pluse: "\u2A72",
      PlusMinus: "\xB1",
      plusmn: "\xB1",
      plussim: "\u2A26",
      plustwo: "\u2A27",
      pm: "\xB1",
      Poincareplane: "\u210C",
      pointint: "\u2A15",
      Popf: "\u2119",
      popf: "\u{1D561}",
      pound: "\xA3",
      Pr: "\u2ABB",
      pr: "\u227A",
      prap: "\u2AB7",
      prcue: "\u227C",
      prE: "\u2AB3",
      pre: "\u2AAF",
      prec: "\u227A",
      precapprox: "\u2AB7",
      preccurlyeq: "\u227C",
      Precedes: "\u227A",
      PrecedesEqual: "\u2AAF",
      PrecedesSlantEqual: "\u227C",
      PrecedesTilde: "\u227E",
      preceq: "\u2AAF",
      precnapprox: "\u2AB9",
      precneqq: "\u2AB5",
      precnsim: "\u22E8",
      precsim: "\u227E",
      Prime: "\u2033",
      prime: "\u2032",
      primes: "\u2119",
      prnap: "\u2AB9",
      prnE: "\u2AB5",
      prnsim: "\u22E8",
      prod: "\u220F",
      Product: "\u220F",
      profalar: "\u232E",
      profline: "\u2312",
      profsurf: "\u2313",
      prop: "\u221D",
      Proportion: "\u2237",
      Proportional: "\u221D",
      propto: "\u221D",
      prsim: "\u227E",
      prurel: "\u22B0",
      Pscr: "\u{1D4AB}",
      pscr: "\u{1D4C5}",
      Psi: "\u03A8",
      psi: "\u03C8",
      puncsp: "\u2008",
      Qfr: "\u{1D514}",
      qfr: "\u{1D52E}",
      qint: "\u2A0C",
      Qopf: "\u211A",
      qopf: "\u{1D562}",
      qprime: "\u2057",
      Qscr: "\u{1D4AC}",
      qscr: "\u{1D4C6}",
      quaternions: "\u210D",
      quatint: "\u2A16",
      quest: "?",
      questeq: "\u225F",
      QUOT: '"',
      quot: '"',
      rAarr: "\u21DB",
      race: "\u223D\u0331",
      Racute: "\u0154",
      racute: "\u0155",
      radic: "\u221A",
      raemptyv: "\u29B3",
      Rang: "\u27EB",
      rang: "\u27E9",
      rangd: "\u2992",
      range: "\u29A5",
      rangle: "\u27E9",
      raquo: "\xBB",
      Rarr: "\u21A0",
      rArr: "\u21D2",
      rarr: "\u2192",
      rarrap: "\u2975",
      rarrb: "\u21E5",
      rarrbfs: "\u2920",
      rarrc: "\u2933",
      rarrfs: "\u291E",
      rarrhk: "\u21AA",
      rarrlp: "\u21AC",
      rarrpl: "\u2945",
      rarrsim: "\u2974",
      Rarrtl: "\u2916",
      rarrtl: "\u21A3",
      rarrw: "\u219D",
      rAtail: "\u291C",
      ratail: "\u291A",
      ratio: "\u2236",
      rationals: "\u211A",
      RBarr: "\u2910",
      rBarr: "\u290F",
      rbarr: "\u290D",
      rbbrk: "\u2773",
      rbrace: "}",
      rbrack: "]",
      rbrke: "\u298C",
      rbrksld: "\u298E",
      rbrkslu: "\u2990",
      Rcaron: "\u0158",
      rcaron: "\u0159",
      Rcedil: "\u0156",
      rcedil: "\u0157",
      rceil: "\u2309",
      rcub: "}",
      Rcy: "\u0420",
      rcy: "\u0440",
      rdca: "\u2937",
      rdldhar: "\u2969",
      rdquo: "\u201D",
      rdquor: "\u201D",
      rdsh: "\u21B3",
      Re: "\u211C",
      real: "\u211C",
      realine: "\u211B",
      realpart: "\u211C",
      reals: "\u211D",
      rect: "\u25AD",
      REG: "\xAE",
      reg: "\xAE",
      ReverseElement: "\u220B",
      ReverseEquilibrium: "\u21CB",
      ReverseUpEquilibrium: "\u296F",
      rfisht: "\u297D",
      rfloor: "\u230B",
      Rfr: "\u211C",
      rfr: "\u{1D52F}",
      rHar: "\u2964",
      rhard: "\u21C1",
      rharu: "\u21C0",
      rharul: "\u296C",
      Rho: "\u03A1",
      rho: "\u03C1",
      rhov: "\u03F1",
      RightAngleBracket: "\u27E9",
      RightArrow: "\u2192",
      Rightarrow: "\u21D2",
      rightarrow: "\u2192",
      RightArrowBar: "\u21E5",
      RightArrowLeftArrow: "\u21C4",
      rightarrowtail: "\u21A3",
      RightCeiling: "\u2309",
      RightDoubleBracket: "\u27E7",
      RightDownTeeVector: "\u295D",
      RightDownVector: "\u21C2",
      RightDownVectorBar: "\u2955",
      RightFloor: "\u230B",
      rightharpoondown: "\u21C1",
      rightharpoonup: "\u21C0",
      rightleftarrows: "\u21C4",
      rightleftharpoons: "\u21CC",
      rightrightarrows: "\u21C9",
      rightsquigarrow: "\u219D",
      RightTee: "\u22A2",
      RightTeeArrow: "\u21A6",
      RightTeeVector: "\u295B",
      rightthreetimes: "\u22CC",
      RightTriangle: "\u22B3",
      RightTriangleBar: "\u29D0",
      RightTriangleEqual: "\u22B5",
      RightUpDownVector: "\u294F",
      RightUpTeeVector: "\u295C",
      RightUpVector: "\u21BE",
      RightUpVectorBar: "\u2954",
      RightVector: "\u21C0",
      RightVectorBar: "\u2953",
      ring: "\u02DA",
      risingdotseq: "\u2253",
      rlarr: "\u21C4",
      rlhar: "\u21CC",
      rlm: "\u200F",
      rmoust: "\u23B1",
      rmoustache: "\u23B1",
      rnmid: "\u2AEE",
      roang: "\u27ED",
      roarr: "\u21FE",
      robrk: "\u27E7",
      ropar: "\u2986",
      Ropf: "\u211D",
      ropf: "\u{1D563}",
      roplus: "\u2A2E",
      rotimes: "\u2A35",
      RoundImplies: "\u2970",
      rpar: ")",
      rpargt: "\u2994",
      rppolint: "\u2A12",
      rrarr: "\u21C9",
      Rrightarrow: "\u21DB",
      rsaquo: "\u203A",
      Rscr: "\u211B",
      rscr: "\u{1D4C7}",
      Rsh: "\u21B1",
      rsh: "\u21B1",
      rsqb: "]",
      rsquo: "\u2019",
      rsquor: "\u2019",
      rthree: "\u22CC",
      rtimes: "\u22CA",
      rtri: "\u25B9",
      rtrie: "\u22B5",
      rtrif: "\u25B8",
      rtriltri: "\u29CE",
      RuleDelayed: "\u29F4",
      ruluhar: "\u2968",
      rx: "\u211E",
      Sacute: "\u015A",
      sacute: "\u015B",
      sbquo: "\u201A",
      Sc: "\u2ABC",
      sc: "\u227B",
      scap: "\u2AB8",
      Scaron: "\u0160",
      scaron: "\u0161",
      sccue: "\u227D",
      scE: "\u2AB4",
      sce: "\u2AB0",
      Scedil: "\u015E",
      scedil: "\u015F",
      Scirc: "\u015C",
      scirc: "\u015D",
      scnap: "\u2ABA",
      scnE: "\u2AB6",
      scnsim: "\u22E9",
      scpolint: "\u2A13",
      scsim: "\u227F",
      Scy: "\u0421",
      scy: "\u0441",
      sdot: "\u22C5",
      sdotb: "\u22A1",
      sdote: "\u2A66",
      searhk: "\u2925",
      seArr: "\u21D8",
      searr: "\u2198",
      searrow: "\u2198",
      sect: "\xA7",
      semi: ";",
      seswar: "\u2929",
      setminus: "\u2216",
      setmn: "\u2216",
      sext: "\u2736",
      Sfr: "\u{1D516}",
      sfr: "\u{1D530}",
      sfrown: "\u2322",
      sharp: "\u266F",
      SHCHcy: "\u0429",
      shchcy: "\u0449",
      SHcy: "\u0428",
      shcy: "\u0448",
      ShortDownArrow: "\u2193",
      ShortLeftArrow: "\u2190",
      shortmid: "\u2223",
      shortparallel: "\u2225",
      ShortRightArrow: "\u2192",
      ShortUpArrow: "\u2191",
      shy: "\xAD",
      Sigma: "\u03A3",
      sigma: "\u03C3",
      sigmaf: "\u03C2",
      sigmav: "\u03C2",
      sim: "\u223C",
      simdot: "\u2A6A",
      sime: "\u2243",
      simeq: "\u2243",
      simg: "\u2A9E",
      simgE: "\u2AA0",
      siml: "\u2A9D",
      simlE: "\u2A9F",
      simne: "\u2246",
      simplus: "\u2A24",
      simrarr: "\u2972",
      slarr: "\u2190",
      SmallCircle: "\u2218",
      smallsetminus: "\u2216",
      smashp: "\u2A33",
      smeparsl: "\u29E4",
      smid: "\u2223",
      smile: "\u2323",
      smt: "\u2AAA",
      smte: "\u2AAC",
      smtes: "\u2AAC\uFE00",
      SOFTcy: "\u042C",
      softcy: "\u044C",
      sol: "/",
      solb: "\u29C4",
      solbar: "\u233F",
      Sopf: "\u{1D54A}",
      sopf: "\u{1D564}",
      spades: "\u2660",
      spadesuit: "\u2660",
      spar: "\u2225",
      sqcap: "\u2293",
      sqcaps: "\u2293\uFE00",
      sqcup: "\u2294",
      sqcups: "\u2294\uFE00",
      Sqrt: "\u221A",
      sqsub: "\u228F",
      sqsube: "\u2291",
      sqsubset: "\u228F",
      sqsubseteq: "\u2291",
      sqsup: "\u2290",
      sqsupe: "\u2292",
      sqsupset: "\u2290",
      sqsupseteq: "\u2292",
      squ: "\u25A1",
      Square: "\u25A1",
      square: "\u25A1",
      SquareIntersection: "\u2293",
      SquareSubset: "\u228F",
      SquareSubsetEqual: "\u2291",
      SquareSuperset: "\u2290",
      SquareSupersetEqual: "\u2292",
      SquareUnion: "\u2294",
      squarf: "\u25AA",
      squf: "\u25AA",
      srarr: "\u2192",
      Sscr: "\u{1D4AE}",
      sscr: "\u{1D4C8}",
      ssetmn: "\u2216",
      ssmile: "\u2323",
      sstarf: "\u22C6",
      Star: "\u22C6",
      star: "\u2606",
      starf: "\u2605",
      straightepsilon: "\u03F5",
      straightphi: "\u03D5",
      strns: "\xAF",
      Sub: "\u22D0",
      sub: "\u2282",
      subdot: "\u2ABD",
      subE: "\u2AC5",
      sube: "\u2286",
      subedot: "\u2AC3",
      submult: "\u2AC1",
      subnE: "\u2ACB",
      subne: "\u228A",
      subplus: "\u2ABF",
      subrarr: "\u2979",
      Subset: "\u22D0",
      subset: "\u2282",
      subseteq: "\u2286",
      subseteqq: "\u2AC5",
      SubsetEqual: "\u2286",
      subsetneq: "\u228A",
      subsetneqq: "\u2ACB",
      subsim: "\u2AC7",
      subsub: "\u2AD5",
      subsup: "\u2AD3",
      succ: "\u227B",
      succapprox: "\u2AB8",
      succcurlyeq: "\u227D",
      Succeeds: "\u227B",
      SucceedsEqual: "\u2AB0",
      SucceedsSlantEqual: "\u227D",
      SucceedsTilde: "\u227F",
      succeq: "\u2AB0",
      succnapprox: "\u2ABA",
      succneqq: "\u2AB6",
      succnsim: "\u22E9",
      succsim: "\u227F",
      SuchThat: "\u220B",
      Sum: "\u2211",
      sum: "\u2211",
      sung: "\u266A",
      Sup: "\u22D1",
      sup: "\u2283",
      sup1: "\xB9",
      sup2: "\xB2",
      sup3: "\xB3",
      supdot: "\u2ABE",
      supdsub: "\u2AD8",
      supE: "\u2AC6",
      supe: "\u2287",
      supedot: "\u2AC4",
      Superset: "\u2283",
      SupersetEqual: "\u2287",
      suphsol: "\u27C9",
      suphsub: "\u2AD7",
      suplarr: "\u297B",
      supmult: "\u2AC2",
      supnE: "\u2ACC",
      supne: "\u228B",
      supplus: "\u2AC0",
      Supset: "\u22D1",
      supset: "\u2283",
      supseteq: "\u2287",
      supseteqq: "\u2AC6",
      supsetneq: "\u228B",
      supsetneqq: "\u2ACC",
      supsim: "\u2AC8",
      supsub: "\u2AD4",
      supsup: "\u2AD6",
      swarhk: "\u2926",
      swArr: "\u21D9",
      swarr: "\u2199",
      swarrow: "\u2199",
      swnwar: "\u292A",
      szlig: "\xDF",
      Tab: "	",
      target: "\u2316",
      Tau: "\u03A4",
      tau: "\u03C4",
      tbrk: "\u23B4",
      Tcaron: "\u0164",
      tcaron: "\u0165",
      Tcedil: "\u0162",
      tcedil: "\u0163",
      Tcy: "\u0422",
      tcy: "\u0442",
      tdot: "\u20DB",
      telrec: "\u2315",
      Tfr: "\u{1D517}",
      tfr: "\u{1D531}",
      there4: "\u2234",
      Therefore: "\u2234",
      therefore: "\u2234",
      Theta: "\u0398",
      theta: "\u03B8",
      thetasym: "\u03D1",
      thetav: "\u03D1",
      thickapprox: "\u2248",
      thicksim: "\u223C",
      ThickSpace: "\u205F\u200A",
      thinsp: "\u2009",
      ThinSpace: "\u2009",
      thkap: "\u2248",
      thksim: "\u223C",
      THORN: "\xDE",
      thorn: "\xFE",
      Tilde: "\u223C",
      tilde: "\u02DC",
      TildeEqual: "\u2243",
      TildeFullEqual: "\u2245",
      TildeTilde: "\u2248",
      times: "\xD7",
      timesb: "\u22A0",
      timesbar: "\u2A31",
      timesd: "\u2A30",
      tint: "\u222D",
      toea: "\u2928",
      top: "\u22A4",
      topbot: "\u2336",
      topcir: "\u2AF1",
      Topf: "\u{1D54B}",
      topf: "\u{1D565}",
      topfork: "\u2ADA",
      tosa: "\u2929",
      tprime: "\u2034",
      TRADE: "\u2122",
      trade: "\u2122",
      triangle: "\u25B5",
      triangledown: "\u25BF",
      triangleleft: "\u25C3",
      trianglelefteq: "\u22B4",
      triangleq: "\u225C",
      triangleright: "\u25B9",
      trianglerighteq: "\u22B5",
      tridot: "\u25EC",
      trie: "\u225C",
      triminus: "\u2A3A",
      TripleDot: "\u20DB",
      triplus: "\u2A39",
      trisb: "\u29CD",
      tritime: "\u2A3B",
      trpezium: "\u23E2",
      Tscr: "\u{1D4AF}",
      tscr: "\u{1D4C9}",
      TScy: "\u0426",
      tscy: "\u0446",
      TSHcy: "\u040B",
      tshcy: "\u045B",
      Tstrok: "\u0166",
      tstrok: "\u0167",
      twixt: "\u226C",
      twoheadleftarrow: "\u219E",
      twoheadrightarrow: "\u21A0",
      Uacute: "\xDA",
      uacute: "\xFA",
      Uarr: "\u219F",
      uArr: "\u21D1",
      uarr: "\u2191",
      Uarrocir: "\u2949",
      Ubrcy: "\u040E",
      ubrcy: "\u045E",
      Ubreve: "\u016C",
      ubreve: "\u016D",
      Ucirc: "\xDB",
      ucirc: "\xFB",
      Ucy: "\u0423",
      ucy: "\u0443",
      udarr: "\u21C5",
      Udblac: "\u0170",
      udblac: "\u0171",
      udhar: "\u296E",
      ufisht: "\u297E",
      Ufr: "\u{1D518}",
      ufr: "\u{1D532}",
      Ugrave: "\xD9",
      ugrave: "\xF9",
      uHar: "\u2963",
      uharl: "\u21BF",
      uharr: "\u21BE",
      uhblk: "\u2580",
      ulcorn: "\u231C",
      ulcorner: "\u231C",
      ulcrop: "\u230F",
      ultri: "\u25F8",
      Umacr: "\u016A",
      umacr: "\u016B",
      uml: "\xA8",
      UnderBar: "_",
      UnderBrace: "\u23DF",
      UnderBracket: "\u23B5",
      UnderParenthesis: "\u23DD",
      Union: "\u22C3",
      UnionPlus: "\u228E",
      Uogon: "\u0172",
      uogon: "\u0173",
      Uopf: "\u{1D54C}",
      uopf: "\u{1D566}",
      UpArrow: "\u2191",
      Uparrow: "\u21D1",
      uparrow: "\u2191",
      UpArrowBar: "\u2912",
      UpArrowDownArrow: "\u21C5",
      UpDownArrow: "\u2195",
      Updownarrow: "\u21D5",
      updownarrow: "\u2195",
      UpEquilibrium: "\u296E",
      upharpoonleft: "\u21BF",
      upharpoonright: "\u21BE",
      uplus: "\u228E",
      UpperLeftArrow: "\u2196",
      UpperRightArrow: "\u2197",
      Upsi: "\u03D2",
      upsi: "\u03C5",
      upsih: "\u03D2",
      Upsilon: "\u03A5",
      upsilon: "\u03C5",
      UpTee: "\u22A5",
      UpTeeArrow: "\u21A5",
      upuparrows: "\u21C8",
      urcorn: "\u231D",
      urcorner: "\u231D",
      urcrop: "\u230E",
      Uring: "\u016E",
      uring: "\u016F",
      urtri: "\u25F9",
      Uscr: "\u{1D4B0}",
      uscr: "\u{1D4CA}",
      utdot: "\u22F0",
      Utilde: "\u0168",
      utilde: "\u0169",
      utri: "\u25B5",
      utrif: "\u25B4",
      uuarr: "\u21C8",
      Uuml: "\xDC",
      uuml: "\xFC",
      uwangle: "\u29A7",
      vangrt: "\u299C",
      varepsilon: "\u03F5",
      varkappa: "\u03F0",
      varnothing: "\u2205",
      varphi: "\u03D5",
      varpi: "\u03D6",
      varpropto: "\u221D",
      vArr: "\u21D5",
      varr: "\u2195",
      varrho: "\u03F1",
      varsigma: "\u03C2",
      varsubsetneq: "\u228A\uFE00",
      varsubsetneqq: "\u2ACB\uFE00",
      varsupsetneq: "\u228B\uFE00",
      varsupsetneqq: "\u2ACC\uFE00",
      vartheta: "\u03D1",
      vartriangleleft: "\u22B2",
      vartriangleright: "\u22B3",
      Vbar: "\u2AEB",
      vBar: "\u2AE8",
      vBarv: "\u2AE9",
      Vcy: "\u0412",
      vcy: "\u0432",
      VDash: "\u22AB",
      Vdash: "\u22A9",
      vDash: "\u22A8",
      vdash: "\u22A2",
      Vdashl: "\u2AE6",
      Vee: "\u22C1",
      vee: "\u2228",
      veebar: "\u22BB",
      veeeq: "\u225A",
      vellip: "\u22EE",
      Verbar: "\u2016",
      verbar: "|",
      Vert: "\u2016",
      vert: "|",
      VerticalBar: "\u2223",
      VerticalLine: "|",
      VerticalSeparator: "\u2758",
      VerticalTilde: "\u2240",
      VeryThinSpace: "\u200A",
      Vfr: "\u{1D519}",
      vfr: "\u{1D533}",
      vltri: "\u22B2",
      vnsub: "\u2282\u20D2",
      vnsup: "\u2283\u20D2",
      Vopf: "\u{1D54D}",
      vopf: "\u{1D567}",
      vprop: "\u221D",
      vrtri: "\u22B3",
      Vscr: "\u{1D4B1}",
      vscr: "\u{1D4CB}",
      vsubnE: "\u2ACB\uFE00",
      vsubne: "\u228A\uFE00",
      vsupnE: "\u2ACC\uFE00",
      vsupne: "\u228B\uFE00",
      Vvdash: "\u22AA",
      vzigzag: "\u299A",
      Wcirc: "\u0174",
      wcirc: "\u0175",
      wedbar: "\u2A5F",
      Wedge: "\u22C0",
      wedge: "\u2227",
      wedgeq: "\u2259",
      weierp: "\u2118",
      Wfr: "\u{1D51A}",
      wfr: "\u{1D534}",
      Wopf: "\u{1D54E}",
      wopf: "\u{1D568}",
      wp: "\u2118",
      wr: "\u2240",
      wreath: "\u2240",
      Wscr: "\u{1D4B2}",
      wscr: "\u{1D4CC}",
      xcap: "\u22C2",
      xcirc: "\u25EF",
      xcup: "\u22C3",
      xdtri: "\u25BD",
      Xfr: "\u{1D51B}",
      xfr: "\u{1D535}",
      xhArr: "\u27FA",
      xharr: "\u27F7",
      Xi: "\u039E",
      xi: "\u03BE",
      xlArr: "\u27F8",
      xlarr: "\u27F5",
      xmap: "\u27FC",
      xnis: "\u22FB",
      xodot: "\u2A00",
      Xopf: "\u{1D54F}",
      xopf: "\u{1D569}",
      xoplus: "\u2A01",
      xotime: "\u2A02",
      xrArr: "\u27F9",
      xrarr: "\u27F6",
      Xscr: "\u{1D4B3}",
      xscr: "\u{1D4CD}",
      xsqcup: "\u2A06",
      xuplus: "\u2A04",
      xutri: "\u25B3",
      xvee: "\u22C1",
      xwedge: "\u22C0",
      Yacute: "\xDD",
      yacute: "\xFD",
      YAcy: "\u042F",
      yacy: "\u044F",
      Ycirc: "\u0176",
      ycirc: "\u0177",
      Ycy: "\u042B",
      ycy: "\u044B",
      yen: "\xA5",
      Yfr: "\u{1D51C}",
      yfr: "\u{1D536}",
      YIcy: "\u0407",
      yicy: "\u0457",
      Yopf: "\u{1D550}",
      yopf: "\u{1D56A}",
      Yscr: "\u{1D4B4}",
      yscr: "\u{1D4CE}",
      YUcy: "\u042E",
      yucy: "\u044E",
      Yuml: "\u0178",
      yuml: "\xFF",
      Zacute: "\u0179",
      zacute: "\u017A",
      Zcaron: "\u017D",
      zcaron: "\u017E",
      Zcy: "\u0417",
      zcy: "\u0437",
      Zdot: "\u017B",
      zdot: "\u017C",
      zeetrf: "\u2128",
      ZeroWidthSpace: "\u200B",
      Zeta: "\u0396",
      zeta: "\u03B6",
      Zfr: "\u2128",
      zfr: "\u{1D537}",
      ZHcy: "\u0416",
      zhcy: "\u0436",
      zigrarr: "\u21DD",
      Zopf: "\u2124",
      zopf: "\u{1D56B}",
      Zscr: "\u{1D4B5}",
      zscr: "\u{1D4CF}",
      zwj: "\u200D",
      zwnj: "\u200C"
    });
    exports.entityMap = exports.HTML_ENTITIES;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/sax.js
var require_sax = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/sax.js"(exports) {
    "use strict";
    var conventions = require_conventions();
    var g = require_grammar();
    var errors = require_errors();
    var isHTMLEscapableRawTextElement = conventions.isHTMLEscapableRawTextElement;
    var isHTMLMimeType = conventions.isHTMLMimeType;
    var isHTMLRawTextElement = conventions.isHTMLRawTextElement;
    var hasOwn = conventions.hasOwn;
    var NAMESPACE = conventions.NAMESPACE;
    var ParseError = errors.ParseError;
    var DOMException = errors.DOMException;
    var S_TAG = 0;
    var S_ATTR = 1;
    var S_ATTR_SPACE = 2;
    var S_EQ = 3;
    var S_ATTR_NOQUOT_VALUE = 4;
    var S_ATTR_END = 5;
    var S_TAG_SPACE = 6;
    var S_TAG_CLOSE = 7;
    function XMLReader() {
    }
    XMLReader.prototype = {
      parse: function(source, defaultNSMap, entityMap) {
        var domBuilder = this.domBuilder;
        domBuilder.startDocument();
        _copy(defaultNSMap, defaultNSMap = /* @__PURE__ */ Object.create(null));
        parse(source, defaultNSMap, entityMap, domBuilder, this.errorHandler);
        domBuilder.endDocument();
      }
    };
    var ENTITY_REG = /&#?\w+;?/g;
    function parse(source, defaultNSMapCopy, entityMap, domBuilder, errorHandler) {
      var isHTML = isHTMLMimeType(domBuilder.mimeType);
      if (source.indexOf(g.UNICODE_REPLACEMENT_CHARACTER) >= 0) {
        errorHandler.warning("Unicode replacement character detected, source encoding issues?");
      }
      function fixedFromCharCode(code) {
        if (code > 65535) {
          code -= 65536;
          var surrogate1 = 55296 + (code >> 10), surrogate2 = 56320 + (code & 1023);
          return String.fromCharCode(surrogate1, surrogate2);
        } else {
          return String.fromCharCode(code);
        }
      }
      function entityReplacer(a2) {
        var complete = a2[a2.length - 1] === ";" ? a2 : a2 + ";";
        if (!isHTML && complete !== a2) {
          errorHandler.error("EntityRef: expecting ;");
          return a2;
        }
        var match = g.Reference.exec(complete);
        if (!match || match[0].length !== complete.length) {
          errorHandler.error("entity not matching Reference production: " + a2);
          return a2;
        }
        var k = complete.slice(1, -1);
        if (hasOwn(entityMap, k)) {
          return entityMap[k];
        } else if (k.charAt(0) === "#") {
          return fixedFromCharCode(parseInt(k.substring(1).replace("x", "0x")));
        } else {
          errorHandler.error("entity not found:" + a2);
          return a2;
        }
      }
      function appendText(end2) {
        if (end2 > start) {
          var xt = source.substring(start, end2).replace(ENTITY_REG, entityReplacer);
          locator && position(start);
          domBuilder.characters(xt, 0, end2 - start);
          start = end2;
        }
      }
      var lineStart = 0;
      var lineEnd = 0;
      var linePattern = /\r\n?|\n|$/g;
      var locator = domBuilder.locator;
      function position(p, m) {
        while (p >= lineEnd && (m = linePattern.exec(source))) {
          lineStart = lineEnd;
          lineEnd = m.index + m[0].length;
          locator.lineNumber++;
        }
        locator.columnNumber = p - lineStart + 1;
      }
      var parseStack = [{ currentNSMap: defaultNSMapCopy }];
      var unclosedTags = [];
      var start = 0;
      while (true) {
        try {
          var tagStart = source.indexOf("<", start);
          if (tagStart < 0) {
            if (!isHTML && unclosedTags.length > 0) {
              return errorHandler.fatalError("unclosed xml tag(s): " + unclosedTags.join(", "));
            }
            if (!source.substring(start).match(/^\s*$/)) {
              var doc = domBuilder.doc;
              var text = doc.createTextNode(source.substring(start));
              if (doc.documentElement) {
                return errorHandler.error("Extra content at the end of the document");
              }
              doc.appendChild(text);
              domBuilder.currentElement = text;
            }
            return;
          }
          if (tagStart > start) {
            var fromSource = source.substring(start, tagStart);
            if (!isHTML && unclosedTags.length === 0) {
              fromSource = fromSource.replace(new RegExp(g.S_OPT.source, "g"), "");
              fromSource && errorHandler.error("Unexpected content outside root element: '" + fromSource + "'");
            }
            appendText(tagStart);
          }
          switch (source.charAt(tagStart + 1)) {
            case "/":
              var end = source.indexOf(">", tagStart + 2);
              var tagNameRaw = source.substring(tagStart + 2, end > 0 ? end : void 0);
              if (!tagNameRaw) {
                return errorHandler.fatalError("end tag name missing");
              }
              var endTagNameStrict = g.reg("^", g.QName_group, g.S_OPT, "$");
              var tagNameMatch = end > 0 && endTagNameStrict.exec(tagNameRaw);
              if (!tagNameMatch) {
                var leadingTagNameMatch = end > 0 && g.reg("^", g.QName_group).exec(tagNameRaw);
                if (isHTML && leadingTagNameMatch) {
                  errorHandler.warning('end tag name contains invalid trailing characters: "' + tagNameRaw + '"');
                  tagNameMatch = leadingTagNameMatch;
                } else if (
                  // Backward compatibility, remove this whole `else if` arm in the next breaking release
                  // (XML then falls through to the `fatalError` below, for a clean mode split: XML fatal,
                  // HTML warning). A valid end-tag name followed by a line break and trailing content was
                  // silently accepted while `reg` still used the `m` flag; re-adding `m` here matches exactly
                  // those inputs, kept recoverable and reported.
                  leadingTagNameMatch && new RegExp(endTagNameStrict.source, endTagNameStrict.flags + "m").test(tagNameRaw)
                ) {
                  errorHandler.error('end tag name is followed by a line break and trailing content: "' + tagNameRaw + '"');
                  tagNameMatch = leadingTagNameMatch;
                } else {
                  return errorHandler.fatalError('end tag name contains invalid characters: "' + tagNameRaw + '"');
                }
              }
              if (!domBuilder.currentElement && !domBuilder.doc.documentElement) {
                return;
              }
              var currentTagName = unclosedTags[unclosedTags.length - 1] || domBuilder.currentElement.tagName || domBuilder.doc.documentElement.tagName || "";
              if (currentTagName !== tagNameMatch[1]) {
                var tagNameLower = tagNameMatch[1].toLowerCase();
                if (!isHTML || currentTagName.toLowerCase() !== tagNameLower) {
                  return errorHandler.fatalError('Opening and ending tag mismatch: "' + currentTagName + '" != "' + tagNameRaw + '"');
                }
              }
              var config = parseStack.pop();
              unclosedTags.pop();
              var localNSMap = config.localNSMap;
              domBuilder.endElement(config.uri, config.localName, currentTagName);
              if (localNSMap) {
                for (var prefix in localNSMap) {
                  if (hasOwn(localNSMap, prefix)) {
                    domBuilder.endPrefixMapping(prefix);
                  }
                }
              }
              end++;
              break;
            // end element
            case "?":
              locator && position(tagStart);
              end = parseProcessingInstruction(source, tagStart, domBuilder, errorHandler);
              break;
            case "!":
              locator && position(tagStart);
              end = parseDoctypeCommentOrCData(source, tagStart, domBuilder, errorHandler, isHTML);
              break;
            default:
              locator && position(tagStart);
              var el = new ElementAttributes();
              var currentNSMap = parseStack[parseStack.length - 1].currentNSMap;
              var end = parseElementStartPart(source, tagStart, el, currentNSMap, entityReplacer, errorHandler, isHTML);
              var len = el.length;
              if (!el.closed) {
                if (isHTML && conventions.isHTMLVoidElement(el.tagName)) {
                  el.closed = true;
                } else {
                  unclosedTags.push(el.tagName);
                }
              }
              if (locator && len) {
                var locator2 = copyLocator(locator, {});
                for (var i = 0; i < len; i++) {
                  var a = el[i];
                  position(a.offset);
                  a.locator = copyLocator(locator, {});
                }
                domBuilder.locator = locator2;
                if (appendElement(el, domBuilder, currentNSMap)) {
                  parseStack.push(el);
                }
                domBuilder.locator = locator;
              } else {
                if (appendElement(el, domBuilder, currentNSMap)) {
                  parseStack.push(el);
                }
              }
              if (isHTML && !el.closed) {
                end = parseHtmlSpecialContent(source, end, el.tagName, entityReplacer, domBuilder);
              } else {
                end++;
              }
          }
        } catch (e) {
          if (e instanceof ParseError) {
            throw e;
          } else if (e instanceof DOMException) {
            return errorHandler.fatalError("Error constructing the DOM: " + e.name + ": " + e.message, e);
          }
          errorHandler.error("element parse error: " + e);
          end = -1;
        }
        if (end > start) {
          start = end;
        } else {
          appendText(Math.max(tagStart, start) + 1);
        }
      }
    }
    function copyLocator(f, t) {
      t.lineNumber = f.lineNumber;
      t.columnNumber = f.columnNumber;
      return t;
    }
    function parseElementStartPart(source, start, el, currentNSMap, entityReplacer, errorHandler, isHTML) {
      function addAttribute(qname, value3, startIndex) {
        if (hasOwn(el.attributeNames, qname)) {
          return errorHandler.fatalError("Attribute " + qname + " redefined");
        }
        if (!isHTML && value3.indexOf("<") >= 0) {
          return errorHandler.fatalError("Unescaped '<' not allowed in attributes values");
        }
        el.addValue(
          qname,
          // @see https://www.w3.org/TR/xml/#AVNormalize
          // since the xmldom sax parser does not "interpret" DTD the following is not implemented:
          // - recursive replacement of (DTD) entity references
          // - trimming and collapsing multiple spaces into a single one for attributes that are not of type CDATA
          value3.replace(/[\t\n\r]/g, " ").replace(ENTITY_REG, entityReplacer),
          startIndex
        );
      }
      var attrName;
      var value2;
      var p = ++start;
      var s = S_TAG;
      while (true) {
        var c = source.charAt(p);
        if (s === S_TAG && c === "<") {
          throw new Error("unexpected < in tag name: " + source.slice(start, p));
        }
        switch (c) {
          case "=":
            if (s === S_ATTR) {
              attrName = source.slice(start, p);
              s = S_EQ;
            } else if (s === S_ATTR_SPACE) {
              s = S_EQ;
            } else {
              throw new Error("attribute equal must after attrName");
            }
            break;
          case "'":
          case '"':
            if (s === S_EQ || s === S_ATTR) {
              if (s === S_ATTR) {
                errorHandler.warning('attribute value must after "="');
                attrName = source.slice(start, p);
              }
              start = p + 1;
              p = source.indexOf(c, start);
              if (p > 0) {
                value2 = source.slice(start, p);
                addAttribute(attrName, value2, start - 1);
                s = S_ATTR_END;
              } else {
                throw new Error("attribute value no end '" + c + "' match");
              }
            } else if (s == S_ATTR_NOQUOT_VALUE) {
              value2 = source.slice(start, p);
              addAttribute(attrName, value2, start);
              errorHandler.warning('attribute "' + attrName + '" missed start quot(' + c + ")!!");
              start = p + 1;
              s = S_ATTR_END;
            } else {
              throw new Error('attribute value must after "="');
            }
            break;
          case "/":
            switch (s) {
              case S_TAG:
                el.setTagName(source.slice(start, p));
              case S_ATTR_END:
              case S_TAG_SPACE:
              case S_TAG_CLOSE:
                s = S_TAG_CLOSE;
                el.closed = true;
              case S_ATTR_NOQUOT_VALUE:
              case S_ATTR:
                break;
              case S_ATTR_SPACE:
                el.closed = true;
                break;
              //case S_EQ:
              default:
                throw new Error("attribute invalid close char('/')");
            }
            break;
          case "":
            errorHandler.error("unexpected end of input");
            if (s == S_TAG) {
              el.setTagName(source.slice(start, p));
            }
            return p;
          case ">":
            switch (s) {
              case S_TAG:
                el.setTagName(source.slice(start, p));
              case S_ATTR_END:
              case S_TAG_SPACE:
              case S_TAG_CLOSE:
                break;
              //normal
              case S_ATTR_NOQUOT_VALUE:
              //Compatible state
              case S_ATTR:
                value2 = source.slice(start, p);
                if (value2.slice(-1) === "/") {
                  el.closed = true;
                  value2 = value2.slice(0, -1);
                }
              case S_ATTR_SPACE:
                if (s === S_ATTR_SPACE) {
                  value2 = attrName;
                }
                if (s == S_ATTR_NOQUOT_VALUE) {
                  errorHandler.warning('attribute "' + value2 + '" missed quot(")!');
                  addAttribute(attrName, value2, start);
                } else {
                  if (!isHTML) {
                    errorHandler.warning('attribute "' + value2 + '" missed value!! "' + value2 + '" instead!!');
                  }
                  addAttribute(value2, value2, start);
                }
                break;
              case S_EQ:
                if (!isHTML) {
                  return errorHandler.fatalError(`AttValue: ' or " expected`);
                }
            }
            return p;
          /*xml space '\x20' | #x9 | #xD | #xA; */
          case "\x80":
            c = " ";
          default:
            if (c <= " ") {
              switch (s) {
                case S_TAG:
                  el.setTagName(source.slice(start, p));
                  s = S_TAG_SPACE;
                  break;
                case S_ATTR:
                  attrName = source.slice(start, p);
                  s = S_ATTR_SPACE;
                  break;
                case S_ATTR_NOQUOT_VALUE:
                  var value2 = source.slice(start, p);
                  errorHandler.warning('attribute "' + value2 + '" missed quot(")!!');
                  addAttribute(attrName, value2, start);
                case S_ATTR_END:
                  s = S_TAG_SPACE;
                  break;
              }
            } else {
              switch (s) {
                //case S_TAG:void();break;
                //case S_ATTR:void();break;
                //case S_ATTR_NOQUOT_VALUE:void();break;
                case S_ATTR_SPACE:
                  if (!isHTML) {
                    errorHandler.warning('attribute "' + attrName + '" missed value!! "' + attrName + '" instead2!!');
                  }
                  addAttribute(attrName, attrName, start);
                  start = p;
                  s = S_ATTR;
                  break;
                case S_ATTR_END:
                  errorHandler.warning('attribute space is required"' + attrName + '"!!');
                case S_TAG_SPACE:
                  s = S_ATTR;
                  start = p;
                  break;
                case S_EQ:
                  s = S_ATTR_NOQUOT_VALUE;
                  start = p;
                  break;
                case S_TAG_CLOSE:
                  throw new Error("elements closed character '/' and '>' must be connected to");
              }
            }
        }
        p++;
      }
    }
    function appendElement(el, domBuilder, currentNSMap) {
      var tagName = el.tagName;
      var localNSMap = null;
      var i = el.length;
      while (i--) {
        var a = el[i];
        var qName = a.qName;
        var value2 = a.value;
        var nsp = qName.indexOf(":");
        if (nsp > 0) {
          var prefix = a.prefix = qName.slice(0, nsp);
          var localName = qName.slice(nsp + 1);
          var nsPrefix = prefix === "xmlns" && localName;
        } else {
          localName = qName;
          prefix = null;
          nsPrefix = qName === "xmlns" && "";
        }
        a.localName = localName;
        if (nsPrefix !== false) {
          if (localNSMap == null) {
            localNSMap = /* @__PURE__ */ Object.create(null);
            currentNSMap = Object.create(currentNSMap);
          }
          currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value2;
          a.uri = NAMESPACE.XMLNS;
          domBuilder.startPrefixMapping(nsPrefix, value2);
        }
      }
      var i = el.length;
      while (i--) {
        a = el[i];
        if (a.prefix) {
          if (a.prefix === "xml") {
            a.uri = NAMESPACE.XML;
          }
          if (a.prefix !== "xmlns") {
            a.uri = currentNSMap[a.prefix];
          }
        }
      }
      var nsp = tagName.indexOf(":");
      if (nsp > 0) {
        prefix = el.prefix = tagName.slice(0, nsp);
        localName = el.localName = tagName.slice(nsp + 1);
      } else {
        prefix = null;
        localName = el.localName = tagName;
      }
      var ns = el.uri = currentNSMap[prefix || ""];
      domBuilder.startElement(ns, localName, tagName, el);
      if (el.closed) {
        domBuilder.endElement(ns, localName, tagName);
        if (localNSMap) {
          for (prefix in localNSMap) {
            if (hasOwn(localNSMap, prefix)) {
              domBuilder.endPrefixMapping(prefix);
            }
          }
        }
      } else {
        el.currentNSMap = currentNSMap;
        el.localNSMap = localNSMap;
        return true;
      }
    }
    function parseHtmlSpecialContent(source, elStartEnd, tagName, entityReplacer, domBuilder) {
      var isEscapableRaw = isHTMLEscapableRawTextElement(tagName);
      if (isEscapableRaw || isHTMLRawTextElement(tagName)) {
        var closeTag = new RegExp("</" + tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ">", "ig");
        closeTag.lastIndex = elStartEnd;
        var match = closeTag.exec(source);
        var elEndStart = match ? match.index : -1;
        if (elEndStart < 0) {
          return elStartEnd + 1;
        }
        var text = source.substring(elStartEnd + 1, elEndStart);
        if (isEscapableRaw) {
          text = text.replace(ENTITY_REG, entityReplacer);
        }
        domBuilder.characters(text, 0, text.length);
        return elEndStart;
      }
      return elStartEnd + 1;
    }
    function _copy(source, target) {
      for (var n in source) {
        if (hasOwn(source, n)) {
          target[n] = source[n];
        }
      }
    }
    function parseUtils(source, start) {
      var index = start;
      function char(n) {
        n = n || 0;
        return source.charAt(index + n);
      }
      function skip(n) {
        n = n || 1;
        index += n;
      }
      function skipBlanks() {
        var blanks = 0;
        while (index < source.length) {
          var c = char();
          if (c !== " " && c !== "\n" && c !== "	" && c !== "\r") {
            return blanks;
          }
          blanks++;
          skip();
        }
        return -1;
      }
      function substringFromIndex() {
        return source.substring(index);
      }
      function substringStartsWith(text) {
        return source.substring(index, index + text.length) === text;
      }
      function substringStartsWithCaseInsensitive(text) {
        return source.substring(index, index + text.length).toUpperCase() === text.toUpperCase();
      }
      function getMatch(args) {
        var expr = g.reg("^", args);
        var match = expr.exec(substringFromIndex());
        if (match) {
          skip(match[0].length);
          return match[0];
        }
        return null;
      }
      return {
        char,
        getIndex: function() {
          return index;
        },
        getMatch,
        getSource: function() {
          return source;
        },
        skip,
        skipBlanks,
        substringFromIndex,
        substringStartsWith,
        substringStartsWithCaseInsensitive
      };
    }
    function parseDoctypeInternalSubset(p, errorHandler) {
      function parsePI(p2, errorHandler2) {
        var match = g.PI.exec(p2.substringFromIndex());
        if (!match) {
          return errorHandler2.fatalError("processing instruction is not well-formed at position " + p2.getIndex());
        }
        if (match[1].toLowerCase() === "xml") {
          return errorHandler2.fatalError(
            "xml declaration is only allowed at the start of the document, but found at position " + p2.getIndex()
          );
        }
        p2.skip(match[0].length);
        return match[0];
      }
      var source = p.getSource();
      if (p.char() === "[") {
        p.skip(1);
        var intSubsetStart = p.getIndex();
        while (p.getIndex() < source.length) {
          p.skipBlanks();
          if (p.char() === "]") {
            var internalSubset = source.substring(intSubsetStart, p.getIndex());
            p.skip(1);
            return internalSubset;
          }
          var current = null;
          if (p.char() === "<" && p.char(1) === "!") {
            switch (p.char(2)) {
              case "E":
                if (p.char(3) === "L") {
                  current = p.getMatch(g.elementdecl);
                } else if (p.char(3) === "N") {
                  current = p.getMatch(g.EntityDecl);
                }
                break;
              case "A":
                current = p.getMatch(g.AttlistDecl);
                break;
              case "N":
                current = p.getMatch(g.NotationDecl);
                break;
              case "-":
                current = p.getMatch(g.Comment);
                break;
            }
          } else if (p.char() === "<" && p.char(1) === "?") {
            current = parsePI(p, errorHandler);
          } else if (p.char() === "%") {
            current = p.getMatch(g.PEReference);
          } else {
            return errorHandler.fatalError("Error detected in Markup declaration");
          }
          if (!current) {
            return errorHandler.fatalError("Error in internal subset at position " + p.getIndex());
          }
        }
        return errorHandler.fatalError("doctype internal subset is not well-formed, missing ]");
      }
    }
    function parseDoctypeCommentOrCData(source, start, domBuilder, errorHandler, isHTML) {
      var p = parseUtils(source, start);
      switch (isHTML ? p.char(2).toUpperCase() : p.char(2)) {
        case "-":
          var comment = p.getMatch(g.Comment);
          if (comment) {
            domBuilder.comment(comment, g.COMMENT_START.length, comment.length - g.COMMENT_START.length - g.COMMENT_END.length);
            return p.getIndex();
          } else {
            return errorHandler.fatalError("comment is not well-formed at position " + p.getIndex());
          }
        case "[":
          var cdata = p.getMatch(g.CDSect);
          if (cdata) {
            if (!isHTML && !domBuilder.currentElement) {
              return errorHandler.fatalError("CDATA outside of element");
            }
            domBuilder.startCDATA();
            domBuilder.characters(cdata, g.CDATA_START.length, cdata.length - g.CDATA_START.length - g.CDATA_END.length);
            domBuilder.endCDATA();
            return p.getIndex();
          } else {
            return errorHandler.fatalError("Invalid CDATA starting at position " + start);
          }
        case "D": {
          if (domBuilder.doc && domBuilder.doc.documentElement) {
            return errorHandler.fatalError("Doctype not allowed inside or after documentElement at position " + p.getIndex());
          }
          if (isHTML ? !p.substringStartsWithCaseInsensitive(g.DOCTYPE_DECL_START) : !p.substringStartsWith(g.DOCTYPE_DECL_START)) {
            return errorHandler.fatalError("Expected " + g.DOCTYPE_DECL_START + " at position " + p.getIndex());
          }
          p.skip(g.DOCTYPE_DECL_START.length);
          if (p.skipBlanks() < 1) {
            return errorHandler.fatalError("Expected whitespace after " + g.DOCTYPE_DECL_START + " at position " + p.getIndex());
          }
          var doctype = {
            name: void 0,
            publicId: void 0,
            systemId: void 0,
            internalSubset: void 0
          };
          doctype.name = p.getMatch(g.Name);
          if (!doctype.name)
            return errorHandler.fatalError("doctype name missing or contains unexpected characters at position " + p.getIndex());
          if (isHTML && doctype.name.toLowerCase() !== "html") {
            errorHandler.warning("Unexpected DOCTYPE in HTML document at position " + p.getIndex());
          }
          p.skipBlanks();
          if (p.substringStartsWith(g.PUBLIC) || p.substringStartsWith(g.SYSTEM)) {
            var match = g.ExternalID_match.exec(p.substringFromIndex());
            if (!match) {
              return errorHandler.fatalError("doctype external id is not well-formed at position " + p.getIndex());
            }
            if (match.groups.SystemLiteralOnly !== void 0) {
              doctype.systemId = match.groups.SystemLiteralOnly;
            } else {
              doctype.systemId = match.groups.SystemLiteral;
              doctype.publicId = match.groups.PubidLiteral;
            }
            p.skip(match[0].length);
          } else if (isHTML && p.substringStartsWithCaseInsensitive(g.SYSTEM)) {
            p.skip(g.SYSTEM.length);
            if (p.skipBlanks() < 1) {
              return errorHandler.fatalError("Expected whitespace after " + g.SYSTEM + " at position " + p.getIndex());
            }
            doctype.systemId = p.getMatch(g.ABOUT_LEGACY_COMPAT_SystemLiteral);
            if (!doctype.systemId) {
              return errorHandler.fatalError(
                "Expected " + g.ABOUT_LEGACY_COMPAT + " in single or double quotes after " + g.SYSTEM + " at position " + p.getIndex()
              );
            }
          }
          if (isHTML && doctype.systemId && !g.ABOUT_LEGACY_COMPAT_SystemLiteral.test(doctype.systemId)) {
            errorHandler.warning("Unexpected doctype.systemId in HTML document at position " + p.getIndex());
          }
          if (!isHTML) {
            p.skipBlanks();
            doctype.internalSubset = parseDoctypeInternalSubset(p, errorHandler);
          }
          p.skipBlanks();
          if (p.char() !== ">") {
            return errorHandler.fatalError("doctype not terminated with > at position " + p.getIndex());
          }
          p.skip(1);
          domBuilder.startDTD(doctype.name, doctype.publicId, doctype.systemId, doctype.internalSubset);
          domBuilder.endDTD();
          return p.getIndex();
        }
        default:
          return errorHandler.fatalError('Not well-formed XML starting with "<!" at position ' + start);
      }
    }
    function parseProcessingInstruction(source, start, domBuilder, errorHandler) {
      var match = source.substring(start).match(g.PI);
      if (!match) {
        return errorHandler.fatalError("Invalid processing instruction starting at position " + start);
      }
      if (match[1].toLowerCase() === "xml") {
        if (start > 0) {
          return errorHandler.fatalError(
            "processing instruction at position " + start + " is an xml declaration which is only at the start of the document"
          );
        }
        if (!g.XMLDecl.test(source.substring(start))) {
          return errorHandler.fatalError("xml declaration is not well-formed");
        }
      }
      domBuilder.processingInstruction(match[1], match[2]);
      return start + match[0].length;
    }
    function ElementAttributes() {
      this.attributeNames = /* @__PURE__ */ Object.create(null);
    }
    ElementAttributes.prototype = {
      setTagName: function(tagName) {
        if (!g.QName_exact.test(tagName)) {
          throw new Error("invalid tagName:" + tagName);
        }
        this.tagName = tagName;
      },
      addValue: function(qName, value2, offset) {
        if (!g.QName_exact.test(qName)) {
          throw new Error("invalid attribute:" + qName);
        }
        this.attributeNames[qName] = this.length;
        this[this.length++] = { qName, value: value2, offset };
      },
      length: 0,
      getLocalName: function(i) {
        return this[i].localName;
      },
      getLocator: function(i) {
        return this[i].locator;
      },
      getQName: function(i) {
        return this[i].qName;
      },
      getURI: function(i) {
        return this[i].uri;
      },
      getValue: function(i) {
        return this[i].value;
      }
      //	,getIndex:function(uri, localName)){
      //		if(localName){
      //
      //		}else{
      //			var qName = uri
      //		}
      //	},
      //	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
      //	getType:function(uri,localName){}
      //	getType:function(i){},
    };
    exports.XMLReader = XMLReader;
    exports.parseUtils = parseUtils;
    exports.parseDoctypeCommentOrCData = parseDoctypeCommentOrCData;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/dom-parser.js
var require_dom_parser = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/dom-parser.js"(exports) {
    "use strict";
    var conventions = require_conventions();
    var dom = require_dom();
    var errors = require_errors();
    var entities = require_entities();
    var sax = require_sax();
    var DOMImplementation = dom.DOMImplementation;
    var hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
    var isHTMLMimeType = conventions.isHTMLMimeType;
    var isValidMimeType = conventions.isValidMimeType;
    var MIME_TYPE = conventions.MIME_TYPE;
    var NAMESPACE = conventions.NAMESPACE;
    var ParseError = errors.ParseError;
    var XMLReader = sax.XMLReader;
    function normalizeLineEndings(input) {
      return input.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028\u2029]/g, "\n");
    }
    function DOMParser3(options) {
      options = options || {};
      if (options.locator === void 0) {
        options.locator = true;
      }
      this.assign = options.assign || conventions.assign;
      this.domHandler = options.domHandler || DOMHandler;
      this.onError = options.onError || options.errorHandler;
      if (options.errorHandler && typeof options.errorHandler !== "function") {
        throw new TypeError("errorHandler object is no longer supported, switch to onError!");
      } else if (options.errorHandler) {
        options.errorHandler("warning", "The `errorHandler` option has been deprecated, use `onError` instead!", this);
      }
      this.normalizeLineEndings = options.normalizeLineEndings || normalizeLineEndings;
      this.locator = !!options.locator;
      this.xmlns = this.assign(/* @__PURE__ */ Object.create(null), options.xmlns);
    }
    DOMParser3.prototype.parseFromString = function(source, mimeType) {
      if (!isValidMimeType(mimeType)) {
        throw new TypeError('DOMParser.parseFromString: the provided mimeType "' + mimeType + '" is not valid.');
      }
      var defaultNSMap = this.assign(/* @__PURE__ */ Object.create(null), this.xmlns);
      var entityMap = entities.XML_ENTITIES;
      var defaultNamespace = defaultNSMap[""] || null;
      if (hasDefaultHTMLNamespace(mimeType)) {
        entityMap = entities.HTML_ENTITIES;
        defaultNamespace = NAMESPACE.HTML;
      } else if (mimeType === MIME_TYPE.XML_SVG_IMAGE) {
        defaultNamespace = NAMESPACE.SVG;
      }
      defaultNSMap[""] = defaultNamespace;
      defaultNSMap.xml = defaultNSMap.xml || NAMESPACE.XML;
      var domBuilder = new this.domHandler({
        mimeType,
        defaultNamespace,
        onError: this.onError
      });
      var locator = this.locator ? {} : void 0;
      if (this.locator) {
        domBuilder.setDocumentLocator(locator);
      }
      var sax2 = new XMLReader();
      sax2.errorHandler = domBuilder;
      sax2.domBuilder = domBuilder;
      var isXml = !conventions.isHTMLMimeType(mimeType);
      if (isXml && typeof source !== "string") {
        sax2.errorHandler.fatalError("source is not a string");
      }
      sax2.parse(this.normalizeLineEndings(String(source)), defaultNSMap, entityMap);
      if (!domBuilder.doc.documentElement) {
        sax2.errorHandler.fatalError("missing root element");
      }
      return domBuilder.doc;
    };
    function DOMHandler(options) {
      var opt = options || {};
      this.mimeType = opt.mimeType || MIME_TYPE.XML_APPLICATION;
      this.defaultNamespace = opt.defaultNamespace || null;
      this.cdata = false;
      this.currentElement = void 0;
      this.doc = void 0;
      this.locator = void 0;
      this.onError = opt.onError;
    }
    function position(locator, node) {
      node.lineNumber = locator.lineNumber;
      node.columnNumber = locator.columnNumber;
    }
    DOMHandler.prototype = {
      /**
       * Either creates an XML or an HTML document and stores it under `this.doc`.
       * If it is an XML document, `this.defaultNamespace` is used to create it,
       * and it will not contain any `childNodes`.
       * If it is an HTML document, it will be created without any `childNodes`.
       *
       * @see http://www.saxproject.org/apidoc/org/xml/sax/ContentHandler.html
       */
      startDocument: function() {
        var impl = new DOMImplementation();
        this.doc = isHTMLMimeType(this.mimeType) ? impl.createHTMLDocument(false) : impl.createDocument(this.defaultNamespace, "");
      },
      startElement: function(namespaceURI, localName, qName, attrs) {
        var doc = this.doc;
        var el = doc.createElementNS(namespaceURI, qName || localName);
        var len = attrs.length;
        appendElement(this, el);
        this.currentElement = el;
        this.locator && position(this.locator, el);
        for (var i = 0; i < len; i++) {
          var namespaceURI = attrs.getURI(i);
          var value2 = attrs.getValue(i);
          var qName = attrs.getQName(i);
          var attr = doc.createAttributeNS(namespaceURI, qName);
          this.locator && position(attrs.getLocator(i), attr);
          attr.value = attr.nodeValue = value2;
          el.setAttributeNode(attr);
        }
      },
      endElement: function(namespaceURI, localName, qName) {
        this.currentElement = this.currentElement.parentNode;
      },
      startPrefixMapping: function(prefix, uri) {
      },
      endPrefixMapping: function(prefix) {
      },
      processingInstruction: function(target, data) {
        var ins = this.doc.createProcessingInstruction(target, data);
        this.locator && position(this.locator, ins);
        appendElement(this, ins);
      },
      ignorableWhitespace: function(ch, start, length) {
      },
      characters: function(chars, start, length) {
        chars = _toString.apply(this, arguments);
        if (chars) {
          if (this.cdata) {
            var charNode = this.doc.createCDATASection(chars);
          } else {
            var charNode = this.doc.createTextNode(chars);
          }
          if (this.currentElement) {
            this.currentElement.appendChild(charNode);
          } else if (/^\s*$/.test(chars)) {
            this.doc.appendChild(charNode);
          }
          this.locator && position(this.locator, charNode);
        }
      },
      skippedEntity: function(name) {
      },
      endDocument: function() {
        this.doc.normalize();
      },
      /**
       * Stores the locator to be able to set the `columnNumber` and `lineNumber`
       * on the created DOM nodes.
       *
       * @param {Locator} locator
       */
      setDocumentLocator: function(locator) {
        if (locator) {
          locator.lineNumber = 0;
        }
        this.locator = locator;
      },
      //LexicalHandler
      comment: function(chars, start, length) {
        chars = _toString.apply(this, arguments);
        var comm = this.doc.createComment(chars);
        this.locator && position(this.locator, comm);
        appendElement(this, comm);
      },
      startCDATA: function() {
        this.cdata = true;
      },
      endCDATA: function() {
        this.cdata = false;
      },
      startDTD: function(name, publicId, systemId, internalSubset) {
        var impl = this.doc.implementation;
        if (impl && impl.createDocumentType) {
          var dt = impl.createDocumentType(name, publicId, systemId, internalSubset);
          this.locator && position(this.locator, dt);
          appendElement(this, dt);
          this.doc.doctype = dt;
        }
      },
      reportError: function(level, message) {
        if (typeof this.onError === "function") {
          try {
            this.onError(level, message, this);
          } catch (e) {
            throw new ParseError("Reporting " + level + ' "' + message + '" caused ' + e, this.locator);
          }
        } else {
          console.error("[xmldom " + level + "]	" + message, _locator(this.locator));
        }
      },
      /**
       * @see http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
       */
      warning: function(message) {
        this.reportError("warning", message);
      },
      error: function(message) {
        this.reportError("error", message);
      },
      /**
       * This function reports a fatal error and throws a ParseError.
       *
       * @param {string} message
       * - The message to be used for reporting and throwing the error.
       * @param {Error} [cause]
       * The error that caused this fatal error, preserved as the thrown `ParseError`'s `cause`.
       * @returns {never}
       * This function always throws an error and never returns a value.
       * @throws {ParseError}
       * Always throws a ParseError with the provided message.
       */
      fatalError: function(message, cause) {
        this.reportError("fatalError", message);
        throw new ParseError(message, this.locator, cause);
      }
    };
    function _locator(l) {
      if (l) {
        return "\n@#[line:" + l.lineNumber + ",col:" + l.columnNumber + "]";
      }
    }
    function _toString(chars, start, length) {
      if (typeof chars == "string") {
        return chars.substr(start, length);
      } else {
        if (chars.length >= start + length || start) {
          return new java.lang.String(chars, start, length) + "";
        }
        return chars;
      }
    }
    "endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(
      /\w+/g,
      function(key) {
        DOMHandler.prototype[key] = function() {
          return null;
        };
      }
    );
    function appendElement(handler, node) {
      if (!handler.currentElement) {
        handler.doc.appendChild(node);
      } else {
        handler.currentElement.appendChild(node);
      }
    }
    function onErrorStopParsing(level) {
      if (level === "error") throw "onErrorStopParsing";
    }
    function onWarningStopParsing() {
      throw "onWarningStopParsing";
    }
    exports.__DOMHandler = DOMHandler;
    exports.DOMParser = DOMParser3;
    exports.normalizeLineEndings = normalizeLineEndings;
    exports.onErrorStopParsing = onErrorStopParsing;
    exports.onWarningStopParsing = onWarningStopParsing;
  }
});

// ../../node_modules/@xmldom/xmldom/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/@xmldom/xmldom/lib/index.js"(exports) {
    "use strict";
    var conventions = require_conventions();
    exports.assign = conventions.assign;
    exports.hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
    exports.isHTMLMimeType = conventions.isHTMLMimeType;
    exports.isValidMimeType = conventions.isValidMimeType;
    exports.MIME_TYPE = conventions.MIME_TYPE;
    exports.NAMESPACE = conventions.NAMESPACE;
    var errors = require_errors();
    exports.DOMException = errors.DOMException;
    exports.DOMExceptionName = errors.DOMExceptionName;
    exports.ExceptionCode = errors.ExceptionCode;
    exports.ParseError = errors.ParseError;
    var dom = require_dom();
    exports.Attr = dom.Attr;
    exports.CDATASection = dom.CDATASection;
    exports.CharacterData = dom.CharacterData;
    exports.Comment = dom.Comment;
    exports.Document = dom.Document;
    exports.DocumentFragment = dom.DocumentFragment;
    exports.DocumentType = dom.DocumentType;
    exports.DOMImplementation = dom.DOMImplementation;
    exports.Element = dom.Element;
    exports.Entity = dom.Entity;
    exports.EntityReference = dom.EntityReference;
    exports.LiveNodeList = dom.LiveNodeList;
    exports.NamedNodeMap = dom.NamedNodeMap;
    exports.Node = dom.Node;
    exports.NodeList = dom.NodeList;
    exports.Notation = dom.Notation;
    exports.ProcessingInstruction = dom.ProcessingInstruction;
    exports.Text = dom.Text;
    exports.XMLSerializer = dom.XMLSerializer;
    var domParser = require_dom_parser();
    exports.DOMParser = domParser.DOMParser;
    exports.normalizeLineEndings = domParser.normalizeLineEndings;
    exports.onErrorStopParsing = domParser.onErrorStopParsing;
    exports.onWarningStopParsing = domParser.onWarningStopParsing;
  }
});

// src/security/cli.ts
import { existsSync as existsSync7, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join7 } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

// src/security/patch.ts
import { randomUUID } from "node:crypto";
import { closeSync as closeSync2, existsSync as existsSync2, lstatSync as lstatSync2, mkdtempSync, openSync as openSync2, readFileSync as readFileSync2, renameSync, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// ../sandbox/src/docker.ts
import { spawn } from "node:child_process";
var CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
var OUTPUT_CAP = 1e6;
var GRACE_MS = 1e4;
function runDockerImageCommand(args, timeoutMs) {
  if (!["pull", "build", "image"].includes(args[0] ?? "") || args[0] === "image" && !["inspect", "rm"].includes(args[1] ?? "")) {
    return Promise.reject(new Error("Only Docker image retrieval, build, inspect and cleanup are allowed here."));
  }
  return new Promise((resolve4, reject) => {
    const child2 = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      child2.kill();
    }, timeoutMs);
    child2.stdout.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-16384);
    });
    child2.stderr.on("data", (chunk) => {
      error = (error + String(chunk)).slice(-16384);
    });
    child2.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Docker unavailable: ${err.message}`));
    });
    child2.on("close", (code) => {
      clearTimeout(timer);
      if (timeout || code !== 0) reject(new Error(timeout ? "Docker image command timed out." : `Docker image command failed (${code}): ${error.slice(-1500)}`));
      else resolve4(output.trim());
    });
  });
}
function runArgs(name, image, command, tool) {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) throw new Error(`Container name ${JSON.stringify(name)} is not a single safe token.`);
  if (typeof image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Security tests require an immutable local image ID.");
  if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === "string" && a.length > 0 && a.length <= 2e3 && !a.includes("\0")) || command[0].startsWith("-")) throw new Error("Expected a nonempty application test argv.");
  if (tool !== void 0 && tool !== "npm" && tool !== "composer" && tool !== "maven") throw new Error("Unsupported security test tool.");
  const args = ["run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534", "--cpus", "1", "--memory", "512m", "--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m"];
  if (tool === "npm") args.push("--tmpfs", "/app/node_modules/.vite:rw,noexec,nosuid,nodev,size=32m,mode=1777", "--tmpfs", "/app/node_modules/.vite-temp:rw,noexec,nosuid,nodev,size=32m,mode=1777");
  if (tool === "composer") args.push("--tmpfs", "/app/.phpunit.cache:rw,noexec,nosuid,nodev,size=32m,mode=1777");
  if (tool === "maven") args.push("--tmpfs", "/app/target:rw,noexec,nosuid,nodev,size=256m,mode=1777");
  if (tool) args.push("--env", "HOME=/tmp");
  args.push("--entrypoint", command[0], image, ...command.slice(1));
  return args;
}
function runContainer(name, image, command, timeoutMs, tool) {
  const args = runArgs(name, image, command, tool);
  return new Promise((resolve4) => {
    let child2;
    try {
      child2 = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve4({ kind: "spawn_error", message: err instanceof Error && err.message ? err.message : String(err) });
      return;
    }
    let stdout = "", stderr = "", timedOut = false, settled = false;
    let grace;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawn("docker", ["kill", name], { stdio: "ignore" }).on("error", () => {
        });
      } catch {
      }
      grace = setTimeout(() => {
        try {
          child2.kill();
        } catch {
        }
      }, GRACE_MS);
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace !== void 0) clearTimeout(grace);
      resolve4(result);
    };
    const append = (current, chunk) => current.length >= OUTPUT_CAP ? current : (current + String(chunk)).slice(0, OUTPUT_CAP);
    child2.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child2.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child2.on("error", (err) => finish({ kind: "spawn_error", message: err.message }));
    child2.on("close", (exitCode2) => finish({ kind: "exited", exitCode: exitCode2, stdout, stderr, timedOut }));
  });
}

// src/security/php.ts
import { createHash } from "node:crypto";
var RELEASES_URL = "https://www.php.net/releases/index.php";
var hash = (text) => createHash("sha256").update(text).digest("hex");
var VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
function compare(a, b) {
  const av = VERSION.exec(a), bv = VERSION.exec(b);
  if (!av || !bv) throw new Error("Expected exact stable PHP versions.");
  for (let i = 1; i <= 3; i++) {
    const delta = Number(av[i]) - Number(bv[i]);
    if (delta) return delta;
  }
  return 0;
}
function phpImage(dockerfile) {
  if (dockerfile.length > 64 * 1024) throw new Error("Dockerfile exceeds 64 KiB.");
  if (/^\s*#\s*(?:syntax|escape)\s*=/im.test(dockerfile) || /\\\r?\n/.test(dockerfile)) {
    throw new Error("Dockerfile frontend directives and continuations are not supported in this preview.");
  }
  const stages = [...dockerfile.matchAll(/^\s*FROM\s+([^\r\n]+)$/gim)];
  if (stages.length !== 1) throw new Error("Expected one FROM stage. Multi-stage and missing-base projects need manual review.");
  const stage = stages[0];
  const ref = /^(?:(?:docker\.io\/)?library\/)?php:(\d+\.\d+\.\d+)(-?(?:cli|fpm|apache)(?:-[a-z0-9][a-z0-9.-]*)?)(?:@sha256:[a-f0-9]{64})?$/;
  const from = stage[1].trim();
  const match = ref.exec(from);
  if (!match) throw new Error("Use one official PHP image with an exact stable version and flavor, e.g. php:8.4.26-cli-alpine. ARGs, aliases and floating tags are not supported.");
  if (!match[2].startsWith("-")) throw new Error("PHP image flavor must follow a hyphen.");
  if (/^\s*ADD\s/im.test(dockerfile) || /^\s*COPY\s+.*--from[=\s]/im.test(dockerfile) || /^\s*RUN\s+.*--(?:network|mount)[=\s]/im.test(dockerfile)) {
    throw new Error("ADD, external COPY and RUN network/mount overrides are not supported by the offline validator.");
  }
  const start = stage.index + stage[0].indexOf(stage[1]);
  return { reference: from, version: match[1], branch: match[1].split(".").slice(0, 2).join("."), flavor: match[2], start, end: start + stage[1].length };
}
function parseReleases(input, branch) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid official PHP release response.");
  const releases = [];
  for (const [version2, value2] of Object.entries(input)) {
    if (!VERSION.test(version2) || !version2.startsWith(`${branch}.`)) continue;
    if (!value2 || typeof value2 !== "object") throw new Error("Invalid PHP release entry.");
    const item = value2;
    if (typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date)) || !Array.isArray(item.tags) || !item.tags.every((t) => typeof t === "string")) {
      throw new Error("Incomplete PHP release metadata. No update decision was made.");
    }
    releases.push({ version: version2, date: item.date, security: item.tags.includes("security") });
  }
  if (!releases.length) throw new Error(`No official releases found for PHP ${branch}. Do not interpret this as safe or supported.`);
  return releases.sort((a, b) => compare(b.version, a.version));
}
async function scanPhp(dockerfile, fetchFn = fetch) {
  const current = phpImage(dockerfile);
  const url = `${RELEASES_URL}?json&version=${current.branch}&max=100`;
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(15e3), headers: { "User-Agent": "Ludion-Security-Preview", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Official PHP release lookup failed (HTTP ${res.status}). No update decision was made.`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty PHP release response.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      size += value2.byteLength;
      if (size > 1024 * 1024) throw new Error("PHP release response exceeds 1 MiB.");
      chunks.push(value2);
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  const releases = parseReleases(JSON.parse(Buffer.concat(chunks).toString("utf8")), current.branch);
  const fixes = releases.filter((r) => r.security && compare(r.version, current.version) > 0);
  const latest = releases[0];
  const candidate = fixes.length ? { version: latest.version, reference: `php:${latest.version}${current.flavor}` } : null;
  return {
    schema: 1,
    checked_at: (/* @__PURE__ */ new Date()).toISOString(),
    status: candidate ? "update_available" : "no_newer_security_release",
    scope: "dockerfile_base_image",
    current,
    candidate,
    security_releases: fixes,
    source: url,
    note: "Checks official PHP security-release metadata against the Dockerfile, not live deployment inventory or every CVE. No match is not a security guarantee. No major/minor upgrades, EOL certification, or automatic production deployment."
  };
}
function replaceImage(text, image, reference) {
  if (text.slice(image.start, image.end).trim() !== image.reference) throw new Error("Dockerfile changed; scan again.");
  return text.slice(0, image.start) + reference + text.slice(image.end);
}

// src/security/project.ts
import { chmodSync, constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var CONFIG = "ludion.security.json";
var DEFAULT_CONFIG = { schema: 1, dockerfile: "Dockerfile", test: ["php", "tests/smoke.php"], timeout_seconds: 120 };
function rootPath(dir) {
  const root = resolve(dir);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error("Project root must be a real directory.");
  return realpathSync(root);
}
function regularFile(root, file) {
  if (!file || isAbsolute(file) || file.includes("\\") || file.includes(":")) throw new Error("Expected a project-relative path using forward slashes.");
  const full = resolve(root, file);
  const rel = relative(root, full);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path escapes the project.");
  let cursor = root;
  for (const segment of rel.split(sep)) {
    cursor = join(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("Symlinks are not supported.");
  }
  if (!lstatSync(full).isFile()) throw new Error("Expected a regular project file.");
  return full;
}
function readConfig(root) {
  const path = regularFile(root, CONFIG);
  if (lstatSync(path).size > 16 * 1024) throw new Error("Security config exceeds 16 KiB.");
  const value2 = JSON.parse(readFileSync(path, "utf8"));
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw new Error("Invalid security config.");
  const c = value2;
  if (c.ecosystem !== void 0 && c.ecosystem !== "php") {
    if (!["npm", "composer", "maven"].includes(String(c.ecosystem)) || Object.keys(c).some((k) => !["schema", "ecosystem", "image", "test", "timeout_seconds"].includes(k)) || c.schema !== 1 || !Array.isArray(c.test) || !c.test.length || c.test.length > 32 || !c.test.every((a) => typeof a === "string" && a.length > 0 && a.length <= 2e3 && !a.includes("\0")) || String(c.test[0]).startsWith("-") || !Number.isInteger(c.timeout_seconds) || Number(c.timeout_seconds) < 1 || Number(c.timeout_seconds) > 600 || c.image !== void 0 && (typeof c.image !== "string" || c.image.length > 240)) {
      throw new Error("Expected npm/composer/maven ecosystem, optional official tool image, test argv and timeout_seconds (1\u2013600).");
    }
    return c;
  }
  if (Object.keys(c).some((k) => !["schema", "ecosystem", "dockerfile", "test", "timeout_seconds"].includes(k)) || c.schema !== 1 || typeof c.dockerfile !== "string" || !Array.isArray(c.test) || !c.test.length || c.test.length > 32 || !c.test.every((a) => typeof a === "string" && a.length > 0 && a.length <= 2e3 && !a.includes("\0")) || c.test[0].startsWith("-") || !Number.isInteger(c.timeout_seconds) || Number(c.timeout_seconds) < 1 || Number(c.timeout_seconds) > 600) {
    throw new Error("Expected schema 1, dockerfile, a nonempty test argv, and timeout_seconds (1\u2013600). Unknown options are refused.");
  }
  regularFile(root, c.dockerfile);
  return c;
}
function snapshot(root, destination) {
  let bytes = 0, count = 0;
  const entries = [];
  function walk(dir, rel, depth) {
    if (depth > 40) throw new Error("Project snapshot exceeds 40 directory levels.");
    for (const name of readdirSync(dir).sort()) {
      if ([".git", ".ludion", "node_modules", ".ssh", ".aws"].includes(name) || name === ".env" || name.startsWith(".env.")) continue;
      if (++count > 1e4) throw new Error("Project snapshot exceeds 10,000 entries.");
      const src = join(dir, name), key = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(src);
      if (stat.isSymbolicLink()) throw new Error(`Snapshot refuses symlink: ${key}`);
      if (stat.isDirectory()) {
        entries.push(`directory\0${key}\0${stat.mode & 511}`);
        if (destination) mkdirSync(join(destination, key), { recursive: true });
        walk(src, key, depth + 1);
        if (destination) chmodSync(join(destination, key), stat.mode & 511);
      } else {
        if (!stat.isFile() || stat.nlink > 1) throw new Error(`Snapshot refuses non-regular or hard-linked file: ${key}`);
        bytes += stat.size;
        if (bytes > 100 * 1024 * 1024) throw new Error("Project snapshot exceeds 100 MiB.");
        const fd = openSync(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let data;
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Project changed while taking snapshot.");
          data = readFileSync(fd);
        } finally {
          closeSync(fd);
        }
        entries.push(`file\0${key}\0${stat.mode & 511}\0${hash(data)}`);
        if (destination) {
          writeFileSync(join(destination, key), data, { flag: "wx", mode: stat.mode & 511 });
          chmodSync(join(destination, key), stat.mode & 511);
        }
      }
    }
  }
  walk(root, "", 0);
  return hash(entries.join("\n"));
}
function privateState(root) {
  let dir = root;
  for (const name of [".ludion", "security"]) {
    dir = join(dir, name);
    if (!existsSync(dir)) mkdirSync(dir, { mode: 448 });
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Security state must be a real directory.");
  }
  const transactions = readdirSync(dir).filter((name) => name.startsWith("transaction-"));
  if (transactions.length > 1e3) throw new Error("Too many update journals; archive completed records before continuing.");
  for (const name of transactions) {
    const path = regularFile(dir, `${name}/journal.json`);
    if (lstatSync(path).size > 64 * 1024) throw new Error("Invalid update journal; manual recovery required.");
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (!journal || !["complete", "rolled_back"].includes(journal.phase)) throw new Error(`Unfinished dependency update requires manual recovery: ${path}`);
  }
  return dir;
}

// src/security/patch.ts
var dockerCommand = runDockerImageCommand;
function digestFrom(text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch {
    throw new Error("Could not read downloaded PHP image digest.");
  }
  if (!Array.isArray(entries)) throw new Error("Missing official PHP image digest.");
  const digest = entries.find((v) => typeof v === "string" && /^(?:(?:docker\.io\/)?library\/)?php@sha256:[a-f0-9]{64}$/.test(v));
  if (typeof digest !== "string") throw new Error("Downloaded image has no official PHP repository digest.");
  return `php@${digest.split("@")[1]}`;
}
async function patchProject(dir, apply, deps = {}) {
  const active = () => {
    if (deps.signal?.aborted) throw new Error("Update cancelled. No pending source change will be applied.");
  };
  active();
  const root = rootPath(dir), config = readConfig(root);
  if (!("dockerfile" in config)) throw new Error("PHP patch requires a PHP Dockerfile configuration.");
  const dockerfile = regularFile(root, config.dockerfile);
  const original = readFileSync2(dockerfile, "utf8");
  const scan = await scanPhp(original, deps.fetchFn);
  active();
  if (!scan.candidate) return { receipt: null, path: null, scan };
  const state = privateState(root), lock = join2(state, "patch.lock");
  let lockFd;
  try {
    lockFd = openSync2(lock, "wx", 384);
  } catch {
    throw new Error("Another patch may be running, or patch.lock remains after an interruption. Inspect it before retrying.");
  }
  const id = randomUUID(), images = [];
  let temporary = "";
  const receiptPath = join2(state, `${id}.json`);
  const receipt = {
    schema: 1,
    id,
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    finished_at: "",
    outcome: "failed",
    scope: "dockerfile_only_not_deployed",
    scan,
    tree_hash: "",
    dockerfile_before: hash(original),
    dockerfile_after: null,
    old_digest: null,
    new_digest: null,
    test: [...config.test],
    baseline_passed: false,
    candidate_passed: false
  };
  const command = deps.command ?? dockerCommand;
  const run = deps.testRun ?? (async (name, image, command2, timeoutMs) => {
    const result = await runContainer(name, image, command2, timeoutMs);
    if (result.kind === "spawn_error") throw new Error(`Docker unavailable: ${result.message}`);
    if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "Validation timed out." : `Validation exited ${result.exitCode}: ${result.stderr.slice(-1e3)}`);
  });
  let staged;
  try {
    temporary = mkdtempSync(join2(tmpdir(), "ludion-security-"));
    writeFileSync2(lockFd, JSON.stringify({ id, pid: process.pid, started_at: receipt.started_at }));
    receipt.tree_hash = snapshot(root, temporary);
    if (JSON.stringify(readConfig(temporary)) !== JSON.stringify(config)) throw new Error("Validation policy changed during scan; retry.");
    if (readFileSync2(join2(temporary, config.dockerfile), "utf8") !== original) throw new Error("Dockerfile changed during scan; retry.");
    for (const [label, ref, expected] of [
      ["baseline", scan.current.reference, scan.current.version],
      ["candidate", scan.candidate.reference, scan.candidate.version]
    ]) {
      active();
      await command(["pull", ref], 3e5);
      active();
      const digest = digestFrom(await command(["image", "inspect", ref, "--format", "{{json .RepoDigests}}"], 15e3));
      active();
      if (label === "baseline") receipt.old_digest = digest;
      else receipt.new_digest = digest;
      const pinned2 = `${ref.split("@")[0]}@${digest.split("@")[1]}`;
      writeFileSync2(join2(temporary, config.dockerfile), replaceImage(original, scan.current, pinned2));
      const image = `ludion-security-${id}-${label}`;
      images.push(image);
      await command(["build", "--network=none", "--pull=false", "--tag", image, "--file", join2(temporary, config.dockerfile), temporary], 3e5);
      active();
      const imageId = await command(["image", "inspect", image, "--format", "{{.Id}}"], 15e3);
      active();
      const versionName = `ludion-security-${id}-${label}-runtime`;
      await run(versionName, imageId, ["php", "-r", `exit(PHP_VERSION === '${expected}' ? 0 : 1);`], config.timeout_seconds * 1e3);
      active();
      const name = `ludion-security-${id}-${label}-test`;
      await run(name, imageId, config.test, config.timeout_seconds * 1e3);
      active();
      if (label === "baseline") receipt.baseline_passed = true;
      else receipt.candidate_passed = true;
    }
    const pinned = `${scan.candidate.reference}@${receipt.new_digest.split("@")[1]}`;
    const updated = replaceImage(original, scan.current, pinned);
    receipt.dockerfile_after = hash(updated);
    active();
    if (snapshot(root) !== receipt.tree_hash || readFileSync2(regularFile(root, config.dockerfile), "utf8") !== original) throw new Error("Project changed during validation. Dockerfile was not updated; retry.");
    receipt.outcome = "validated";
    receipt.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    writeFileSync2(receiptPath, `${JSON.stringify(receipt, null, 2)}
`, { flag: "wx", mode: 384 });
    if (apply) {
      active();
      staged = `${dockerfile}.ludion-${id}.tmp`;
      writeFileSync2(staged, updated, { flag: "wx", mode: lstatSync2(dockerfile).mode & 511 });
      renameSync(staged, dockerfile);
      staged = void 0;
      receipt.outcome = "applied";
    }
  } catch (err) {
    receipt.outcome = "failed";
    receipt.reason = err instanceof Error ? err.message : String(err);
  } finally {
    receipt.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    try {
      writeFileSync2(receiptPath, `${JSON.stringify(receipt, null, 2)}
`, { mode: 384 });
    } finally {
      for (const image of images) await command(["image", "rm", image], 15e3).catch(() => {
      });
      if (staged && existsSync2(staged)) rmSync(staged);
      if (temporary && (resolve2(temporary).startsWith(resolve2(tmpdir()) + "/") || resolve2(temporary).startsWith(resolve2(tmpdir()) + "\\"))) rmSync(temporary, { recursive: true, force: true });
      closeSync2(lockFd);
      rmSync(lock);
    }
  }
  return { receipt, path: receiptPath, scan };
}

// src/security/dependency-patch.ts
var import_semver5 = __toESM(require_semver2(), 1);
import { randomUUID as randomUUID2 } from "node:crypto";
import { chmodSync as chmodSync2, closeSync as closeSync3, cpSync, lstatSync as lstatSync4, mkdirSync as mkdirSync3, mkdtempSync as mkdtempSync2, openSync as openSync3, readFileSync as readFileSync5, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join5, resolve as resolve3, sep as sep2 } from "node:path";

// src/security/inventory.ts
var import_xmldom = __toESM(require_lib(), 1);
var import_semver = __toESM(require_semver2(), 1);
import { existsSync as existsSync3, lstatSync as lstatSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/lockfile.ts
var PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
function add(map, name, version2) {
  const v = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/.exec(version2.trim())?.[0];
  if (!name || !v || !PACKAGE_NAME.test(name)) return;
  let set = map.get(name);
  if (!set) map.set(name, set = /* @__PURE__ */ new Set());
  set.add(v);
}
function fromPackageLock(text) {
  const map = /* @__PURE__ */ new Map();
  const lock = JSON.parse(text);
  if (lock.packages) {
    for (const [path, info] of Object.entries(lock.packages)) {
      const at = path.lastIndexOf("node_modules/");
      if (at < 0 || info.link || !info.version) continue;
      add(map, info.name ?? path.slice(at + "node_modules/".length), info.version);
    }
    return map;
  }
  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      const alias = /^npm:((?:@[^@/]+\/)?[^@]+)@/.exec(info.version ?? "");
      add(map, alias ? alias[1] : name, alias ? info.version.slice(alias[0].length) : info.version ?? "");
      walk(info.dependencies);
    }
  };
  walk(lock.dependencies);
  return map;
}
function fromPnpmLock(text) {
  const map = /* @__PURE__ */ new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^ {2}['"]?\/?((?:@[^@/\s'"]+\/)?[^@/\s'"]+)@(\d+\.\d+\.\d+[^:'"\s(]*)/.exec(line);
    if (m) add(map, m[1], m[2]);
  }
  return map;
}
function fromYarnLock(text) {
  const map = /* @__PURE__ */ new Map();
  let names = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line) && line.trimEnd().endsWith(":")) {
      names = line.slice(0, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).map((spec) => /^((?:@[^@/]+\/)?[^@]+)@/.exec(spec)?.[1] ?? "").filter(Boolean);
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (v && names.length) for (const n of new Set(names)) add(map, n, v[1]);
  }
  return map;
}

// src/security/inventory.ts
var OSV_NAMES = { npm: "npm", composer: "Packagist", maven: "Maven" };
var MANIFESTS = { npm: ["package.json", "package-lock.json"], composer: ["composer.json", "composer.lock"], maven: ["pom.xml"] };
var DEFAULT_IMAGES = { npm: "node:24-slim", composer: "composer:2", maven: "maven:3.9-eclipse-temurin-21" };
function textFile(root, name) {
  const path = regularFile(root, name);
  if (lstatSync3(path).size > 4 * 1024 * 1024) throw new Error(`${name} exceeds 4 MiB.`);
  return readFileSync3(path, "utf8");
}
function jsonFile(root, name) {
  const value2 = JSON.parse(textFile(root, name));
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw new Error(`Invalid ${name}.`);
  return value2;
}
var namePattern = { npm: /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i, composer: /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i, maven: /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/ };
function packageEntry(ecosystem, name, version2, direct) {
  if (typeof name !== "string" || name.length > 240 || !namePattern[ecosystem].test(name) || typeof version2 !== "string" || version2.length > 100 || !/^v?\d[0-9A-Za-z.+_-]*$/.test(version2)) throw new Error(`Unresolved or invalid ${ecosystem} package coordinate.`);
  return { ecosystem, name, version: version2.replace(/^v(?=\d)/, ""), direct };
}
var unique = (packages) => [...new Map(packages.map((p) => [`${p.name}\0${p.version}`, p])).values()];
function children(element, name) {
  return Array.from(element.childNodes).filter((n) => n.nodeType === 1 && n.localName === name);
}
function child(element, name) {
  return children(element, name)[0];
}
function value(element, name) {
  return child(element, name)?.textContent?.trim();
}
function parsePom(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("DTD/entity declarations are not supported in Maven manifests.");
  const document = new import_xmldom.DOMParser({ onError: (level) => {
    throw new Error(`Invalid Maven XML (${level}).`);
  } }).parseFromString(text, "application/xml");
  const project = document.documentElement;
  if (!project || project.localName !== "project" || project.namespaceURI && project.namespaceURI !== "http://maven.apache.org/POM/4.0.0") throw new Error("Expected a Maven POM project.");
  const props = /* @__PURE__ */ new Map();
  const properties = child(project, "properties");
  if (properties) {
    for (const node of Array.from(properties.childNodes)) if (node.nodeType === 1) props.set(node.localName ?? node.nodeName, node.textContent?.trim() ?? "");
  }
  const limitations = [];
  if (child(project, "parent")) limitations.push("Maven parent inheritance is not resolved by the static scan.");
  if (child(project, "profiles")) limitations.push("Maven profile dependencies are not resolved by the static scan.");
  if (child(project, "modules")) limitations.push("Maven modules must be registered individually.");
  const dependencies = [];
  for (const element of children(child(project, "dependencies") ?? document.createElement("dependencies"), "dependency")) {
    const group = value(element, "groupId"), artifact = value(element, "artifactId");
    const raw = value(element, "version");
    const version2 = raw?.replace(/\$\{([^}]+)\}/g, (_all, key) => props.get(key) ?? `\${${key}}`);
    if (!group || !artifact || !version2 || version2.includes("${") || /[\[\](),]/.test(version2)) {
      limitations.push(`Unresolved Maven dependency: ${group ?? "?"}:${artifact ?? "?"}.`);
      continue;
    }
    const pkg = packageEntry("maven", `${group}:${artifact}`, version2, true);
    dependencies.push({ element, name: pkg.name, version: pkg.version });
  }
  return { document, project, dependencies, limitations };
}
function mavenGraph(input, direct) {
  const packages = [];
  let count = 0;
  const visit = (value2, depth, root) => {
    if (!value2 || typeof value2 !== "object" || depth > 100 || ++count > 2e3) throw new Error("Invalid or oversized resolved Maven dependency graph.");
    if (!root) packages.push(packageEntry("maven", `${value2.groupId}:${value2.artifactId}`, value2.version, direct.has(`${value2.groupId}:${value2.artifactId}`)));
    if (value2.children !== void 0 && !Array.isArray(value2.children)) throw new Error("Invalid Maven graph children.");
    for (const next of value2.children ?? []) visit(next, depth + 1, false);
  };
  visit(input, 0, true);
  if ([...direct].some((name) => !packages.some((p) => p.name === name))) throw new Error("Resolved Maven graph is missing a declared dependency.");
  return unique(packages);
}
function inventory(root, ecosystem) {
  const limitations = [];
  let packages = [], files;
  if (ecosystem === "npm") {
    const manifest = jsonFile(root, "package.json");
    const direct = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }));
    const readers = [["package-lock.json", fromPackageLock], ["pnpm-lock.yaml", fromPnpmLock], ["yarn.lock", fromYarnLock]];
    const reader = readers.find(([file]) => existsSync3(join3(root, file)));
    if (!reader) throw new Error("npm requires a package-lock.json, pnpm-lock.yaml or yarn.lock; unresolved package.json ranges are not scanned as installed versions.");
    files = ["package.json", reader[0]];
    const text = textFile(root, reader[0]);
    const parsed = reader[1](text);
    if (reader[0] !== "package-lock.json") limitations.push("pnpm/yarn detection is supported; automatic dependency patching currently requires package-lock.json.");
    if (reader[0] === "package-lock.json") {
      const lock = JSON.parse(text);
      if (!lock.packages || ![2, 3].includes(lock.lockfileVersion)) throw new Error("Security scanning requires package-lock v2/v3.");
      for (const [path, item] of Object.entries(lock.packages)) {
        if (!path.includes("node_modules/")) continue;
        if (item.link) {
          limitations.push(`Local linked package is outside registry advisory coverage: ${path}.`);
          continue;
        }
        if (typeof item.version !== "string" || !import_semver.default.valid(item.version)) throw new Error(`Invalid exact npm version in ${path}.`);
      }
    }
    const rootVersions = reader[0] === "package-lock.json" ? JSON.parse(text).packages : void 0;
    for (const [name, versions] of parsed) for (const version2 of versions) packages.push(packageEntry(ecosystem, name, version2, direct.has(name) && (!rootVersions || rootVersions[`node_modules/${name}`]?.version === version2)));
    for (const name of direct) {
      if (!packages.some((p) => p.name === name && p.direct)) limitations.push(`No installed registry version found for ${name}.`);
      if (rootVersions?.[`node_modules/${name}`]?.version) {
        const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? manifest.optionalDependencies?.[name];
        if (import_semver.default.validRange(spec) && !import_semver.default.satisfies(rootVersions[`node_modules/${name}`].version, spec)) throw new Error(`Lockfile does not satisfy the direct requirement: ${name}.`);
      }
    }
  } else if (ecosystem === "composer") {
    const manifest = jsonFile(root, "composer.json"), lock = jsonFile(root, "composer.lock");
    const direct = new Set(Object.keys({ ...manifest.require, ...manifest["require-dev"] }));
    if (!Array.isArray(lock.packages) || lock["packages-dev"] !== void 0 && !Array.isArray(lock["packages-dev"])) throw new Error("Invalid Composer lockfile package list.");
    files = [...MANIFESTS.composer];
    packages = [...lock.packages, ...lock["packages-dev"] ?? []].map((p) => packageEntry(ecosystem, p.name, p.version, direct.has(p.name)));
    for (const name of direct) if (name.includes("/") && !packages.some((p) => p.name === name)) limitations.push(`No locked package found for ${name}.`);
  } else {
    const pom = parsePom(textFile(root, "pom.xml"));
    files = ["pom.xml"];
    limitations.push(...pom.limitations);
    packages = pom.dependencies.map((p) => packageEntry(ecosystem, p.name, p.version, true));
  }
  packages = unique(packages);
  if (packages.length > 2e3) throw new Error("Advisory scan exceeds 2,000 distinct installed package versions.");
  return { ecosystem, files, scope: ecosystem === "maven" ? "declared_dependencies_not_transitives_plugins_or_jdk" : "locked_dependencies", packages, limitations };
}
function detectEcosystems(root) {
  const found = [];
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some((f) => existsSync3(join3(root, f)))) found.push("npm");
  if (existsSync3(join3(root, "composer.lock"))) found.push("composer");
  if (existsSync3(join3(root, "pom.xml"))) found.push("maven");
  return found;
}
function raisedRequirement(name, spec, to) {
  if (!import_semver.default.valid(to) || import_semver.default.prerelease(to)) throw new Error("An exact stable fixed-version floor is required.");
  const text = typeof spec === "string" ? spec.trim() : "";
  if (/^=?v?\d+\.\d+\.\d+$/.test(text)) return to;
  if (/^\^v?\d+(?:\.\d+){0,2}$/.test(text)) return `^${to}`;
  if (/^~v?\d+\.\d+\.\d+$/.test(text)) return `~${to}`;
  throw new Error(`${name}'s requirement ${JSON.stringify(spec)} is not an exact version, ^ or ~; raising it keeps its meaning only with review.`);
}
function changedManifest(root, ecosystem, changes, pinned = false) {
  if (ecosystem === "maven") {
    const pom = parsePom(textFile(root, "pom.xml"));
    if (pom.limitations.length) throw new Error(pom.limitations.join(" "));
    for (const change of changes) for (const dependency of pom.dependencies.filter((p) => p.name === change.name && p.version === change.from)) {
      child(dependency.element, "version").textContent = change.to;
    }
    const append = (parent, name2, text) => {
      const node = pom.document.createElementNS(pom.project.namespaceURI, name2);
      if (text !== void 0) node.textContent = text;
      parent.appendChild(node);
      return node;
    };
    for (const change of changes.filter((c) => !pom.dependencies.some((p) => p.name === c.name))) {
      const management = child(pom.project, "dependencyManagement") ?? append(pom.project, "dependencyManagement");
      const dependencies = child(management, "dependencies") ?? append(management, "dependencies");
      const [group, artifact] = change.name.split(":");
      const existing = children(dependencies, "dependency").find((d) => value(d, "groupId") === group && value(d, "artifactId") === artifact);
      const dependency = existing ?? append(dependencies, "dependency");
      if (!existing) {
        append(dependency, "groupId", group);
        append(dependency, "artifactId", artifact);
      }
      const version2 = child(dependency, "version") ?? append(dependency, "version");
      version2.textContent = change.to;
    }
    return new import_xmldom.XMLSerializer().serializeToString(pom.document);
  }
  const name = MANIFESTS[ecosystem][0], manifest = jsonFile(root, name);
  const groups = ecosystem === "npm" ? ["dependencies", "devDependencies", "optionalDependencies"] : ["require", "require-dev"];
  const repeated = changes.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i).filter((n) => ecosystem !== "npm" || groups.some((group) => manifest[group]?.[n] !== void 0));
  if (repeated.length) throw new Error(`More than one installed version of ${[...new Set(repeated)].join(", ")} needs a fix; that needs review.`);
  if (ecosystem === "npm" && existsSync3(join3(root, "package-lock.json"))) {
    const locked = jsonFile(root, "package-lock.json").packages;
    if (!locked || typeof locked !== "object") throw new Error("Fixing npm dependencies requires package-lock v2/v3.");
    for (const change of changes) {
      const rootVersion = locked[`node_modules/${change.name}`]?.version;
      if (groups.some((group) => manifest[group]?.[change.name] !== void 0) && rootVersion !== change.from) {
        throw new Error(`The vulnerable ${change.name}@${change.from} is a nested copy of a direct dependency (the project's own copy is ${rootVersion ?? "missing"}); that needs review.`);
      }
    }
  }
  const direct = /* @__PURE__ */ new Set();
  for (const group of groups) {
    for (const change of changes) if (manifest[group]?.[change.name] !== void 0) {
      const raised = raisedRequirement(change.name, manifest[group][change.name], change.to);
      manifest[group][change.name] = pinned ? change.to : raised;
      direct.add(change.name);
    }
  }
  if (pinned && ecosystem === "npm") {
    const transitive = changes.filter((c) => !direct.has(c.name));
    if (transitive.length) {
      const overrides = manifest.overrides ?? {};
      if (typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Invalid npm overrides.");
      const own = [];
      const keys = (value2) => {
        if (value2 && typeof value2 === "object") for (const [key, inner] of Object.entries(value2)) {
          own.push(key.replace(/^\$/, ""));
          keys(inner);
        }
      };
      keys(overrides);
      for (const change of transitive) {
        if (own.some((key) => key === change.name || key.startsWith(`${change.name}@`))) throw new Error(`The project already overrides ${change.name}; the fix needs review.`);
        overrides[`${change.name}@${change.from}`] = change.to;
      }
      manifest.overrides = overrides;
    }
  }
  return `${JSON.stringify(manifest, null, 2)}
`;
}

// src/security/osv.ts
var import_semver3 = __toESM(require_semver2(), 1);

// src/security/packagist.ts
var import_semver2 = __toESM(require_semver2(), 1);
var PACKAGIST_ADVISORIES = "https://packagist.org/api/security-advisories/";
function version(text) {
  const parts = text.replace(/^v(?=\d)/, "").split(".");
  while (parts.length > 3 && parts.at(-1) === "0") parts.pop();
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  return import_semver2.default.valid([...parts, "0", "0"].slice(0, 3).join("."));
}
function parseConstraint(text) {
  if (text.length > 4e3) return null;
  const out = [];
  for (const alternative of text.split(/\s*\|\|?\s*/)) {
    if (alternative.trim() === "*") {
      out.push([]);
      continue;
    }
    const terms = [];
    for (const raw of alternative.trim().split(/\s*,\s*|\s+/)) {
      const m = /^(<=|>=|<|>|==|=|!=)?(v?\d[\d.]*)$/.exec(raw);
      const v = m ? version(m[2]) : null;
      if (!m || !v) return null;
      terms.push({ op: m[1] === "==" || !m[1] ? "=" : m[1], version: v });
    }
    if (!terms.length) return null;
    out.push(terms);
  }
  return out.length ? out : null;
}
function affects(constraint, installed) {
  const v = import_semver2.default.valid(installed);
  if (!v) return true;
  const holds = (t) => ({ "<": import_semver2.default.lt, "<=": import_semver2.default.lte, ">": import_semver2.default.gt, ">=": import_semver2.default.gte, "=": import_semver2.default.eq, "!=": import_semver2.default.neq })[t.op](v, t.version);
  return constraint.some((alternative) => alternative.every(holds));
}
function fixedEvents(constraint) {
  return constraint.flatMap((alternative) => alternative.filter((t) => t.op === "<").map((t) => ({ fixed: t.version })));
}
async function packagistAdvisories(fetchFn, names) {
  const out = [];
  for (let start = 0; start < names.length; start += 40) {
    const chunk = names.slice(start, start + 40);
    const url = `${PACKAGIST_ADVISORIES}?${chunk.map((n) => `packages[]=${encodeURIComponent(n)}`).join("&")}`;
    const r = await fetchFn(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(2e4), headers: { accept: "application/json", "user-agent": "Ludion-Security-Preview" } });
    if (!r.ok) throw new Error(`Packagist advisory lookup failed (HTTP ${r.status}); no clean result is available.`);
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Empty Packagist response.");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value: value2 } = await reader.read();
        if (done) break;
        size += value2.length;
        if (size > 4 * 1024 * 1024) throw new Error("Packagist response exceeds 4 MiB.");
        chunks.push(value2);
      }
    } finally {
      await reader.cancel().catch(() => {
      });
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const advisories = body?.advisories;
    if (Array.isArray(advisories) && !advisories.length) continue;
    if (!advisories || typeof advisories !== "object" || Array.isArray(advisories)) throw new Error("Invalid Packagist advisory response; no clean result is available.");
    for (const [name, items] of Object.entries(advisories)) {
      if (!chunk.includes(name) || !Array.isArray(items)) throw new Error("Invalid Packagist advisory response; no clean result is available.");
      for (const item of items) {
        if (!item || typeof item !== "object" || typeof item.advisoryId !== "string" || !/^PKSA-[a-z0-9-]{1,60}$/.test(item.advisoryId) || item.packageName !== name || typeof item.affectedVersions !== "string") throw new Error("Invalid Packagist advisory record; no clean result is available.");
        const constraint = parseConstraint(item.affectedVersions);
        const aliases = [item.cve, ...Array.isArray(item.sources) ? item.sources.map((s) => s?.remoteId) : []].filter((s) => typeof s === "string" && /^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/.test(s));
        out.push({
          constraint,
          advisory: { id: item.advisoryId, summary: String(item.title ?? item.advisoryId).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500), aliases: [...new Set(aliases)], affected: [{ package: { ecosystem: "Packagist", name }, ranges: [{ events: constraint ? fixedEvents(constraint) : [] }] }] }
        });
      }
    }
  }
  return out;
}

// src/security/osv.ts
function comparableVersion(version2, ecosystem) {
  if (ecosystem === "maven") {
    if (!/^\d+(?:\.\d+){0,2}$/.test(version2)) return null;
    return import_semver3.default.valid([...version2.split("."), "0", "0"].slice(0, 3).join("."));
  }
  return import_semver3.default.valid(version2);
}
var OsvClient = class {
  cache = /* @__PURE__ */ new Map();
  fetchFn;
  constructor(fetchFn = fetch) {
    this.fetchFn = fetchFn;
  }
  async json(path, body) {
    const r = await this.fetchFn(`https://api.osv.dev/v1/${path}`, { method: body === void 0 ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(2e4), headers: { "accept": "application/json", "content-type": "application/json", "user-agent": "Ludion-Security-Preview" }, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
    if (!r.ok) throw new Error(`OSV lookup failed (HTTP ${r.status}); no clean result is available.`);
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Empty OSV response.");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value: value2 } = await reader.read();
        if (done) break;
        size += value2.length;
        if (size > 4 * 1024 * 1024) throw new Error("OSV response exceeds 4 MiB.");
        chunks.push(value2);
      }
    } finally {
      await reader.cancel().catch(() => {
      });
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid OSV response.");
    return result;
  }
  async ids(packages) {
    const result = /* @__PURE__ */ new Map();
    const key = (p) => `${p.ecosystem}\0${p.name}\0${p.version}`;
    for (let start = 0; start < packages.length; start += 100) {
      let pending = packages.slice(start, start + 100).map((p) => ({ p, token: "" }));
      const pages = /* @__PURE__ */ new Set();
      for (let page = 0; pending.length; page++) {
        if (page >= 20) throw new Error("OSV pagination limit exceeded; scan is incomplete.");
        const response = await this.json("querybatch", { queries: pending.map(({ p, token }) => ({ package: { ecosystem: OSV_NAMES[p.ecosystem], name: p.name }, version: p.version, ...token ? { page_token: token } : {} })) });
        if (!Array.isArray(response.results) || response.results.length !== pending.length) throw new Error("OSV batch result count mismatch.");
        const next = [];
        for (const [i, item] of response.results.entries()) {
          if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((k) => !["vulns", "next_page_token"].includes(k)) || item.vulns !== void 0 && !Array.isArray(item.vulns)) throw new Error("Invalid OSV batch item; no clean result is available.");
          const { p } = pending[i];
          const ids = result.get(key(p)) ?? [];
          for (const vuln of item.vulns ?? []) {
            if (typeof vuln?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(vuln.id)) throw new Error("Invalid OSV advisory id.");
            ids.push(vuln.id);
          }
          result.set(key(p), [...new Set(ids)]);
          if (item.next_page_token !== void 0 && typeof item.next_page_token !== "string") throw new Error("Invalid OSV pagination token.");
          if (item.next_page_token) {
            const marker = `${key(p)}\0${item.next_page_token}`;
            if (pages.has(marker)) throw new Error("OSV repeated a pagination token.");
            pages.add(marker);
            next.push({ p, token: item.next_page_token });
          }
        }
        pending = next;
      }
    }
    return result;
  }
  async advisory(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const item = await this.json(`vulns/${encodeURIComponent(id)}`);
    if (item.id !== id || !Array.isArray(item.affected)) throw new Error("Incomplete OSV advisory record.");
    if (item.withdrawn !== void 0 && (typeof item.withdrawn !== "string" || !Number.isFinite(Date.parse(item.withdrawn)))) throw new Error("Invalid OSV withdrawal timestamp.");
    for (const affected of item.affected) if (typeof affected?.package?.name !== "string" || typeof affected?.package?.ecosystem !== "string" || affected.ranges !== void 0 && !Array.isArray(affected.ranges)) throw new Error("Invalid affected package in OSV record.");
    const advisory = { id, summary: String(item.summary ?? id).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500), aliases: Array.isArray(item.aliases) ? item.aliases.filter((s) => typeof s === "string" && s.length < 200) : [], affected: item.affected, ...typeof item.withdrawn === "string" ? { withdrawn: item.withdrawn } : {} };
    this.cache.set(id, advisory);
    return advisory;
  }
  async scan(inventory2) {
    const ids = await this.ids(inventory2.packages);
    const records = [...new Set([...ids.values()].flat())];
    if (records.length > 1e3) throw new Error("More than 1,000 advisory records; automatic planning is unavailable.");
    for (let at = 0; at < records.length; at += 4) await Promise.all(records.slice(at, at + 4).map((id) => this.advisory(id)));
    const findings = [];
    for (const pkg of inventory2.packages) for (const id of ids.get(`${pkg.ecosystem}\0${pkg.name}\0${pkg.version}`) ?? []) {
      const advisory = this.cache.get(id);
      if (!advisory.withdrawn) findings.push({ package: pkg, advisory });
    }
    const blocked = [], unreadable = [], planned = /* @__PURE__ */ new Map();
    const composer = inventory2.packages.filter((p) => p.ecosystem === "composer");
    const packagist = composer.length ? await packagistAdvisories(this.fetchFn, [...new Set(composer.map((p) => p.name))]) : [];
    const packagistFor = (name) => packagist.filter((a) => a.advisory.affected[0].package.name === name);
    for (const pkg of composer) for (const item of packagistFor(pkg.name)) {
      if (!item.constraint) unreadable.push(`${pkg.name}@${pkg.version}: Packagist advisory ${item.advisory.id} has affected versions Ludion cannot read; review it by hand.`);
      else if (affects(item.constraint, pkg.version)) findings.push({ package: pkg, advisory: item.advisory });
    }
    for (const finding of findings) {
      const { package: pkg, advisory } = finding;
      const current = comparableVersion(pkg.version, pkg.ecosystem);
      const fixed = advisory.affected.filter((a) => a.package.ecosystem === OSV_NAMES[pkg.ecosystem] && a.package.name === pkg.name).flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).flatMap((e) => typeof e.fixed === "string" ? [{ raw: e.fixed, version: comparableVersion(e.fixed, pkg.ecosystem) }] : []))).filter((v) => !!v.version && !import_semver3.default.prerelease(v.version) && !!current && import_semver3.default.gt(v.version, current) && import_semver3.default.major(v.version) === import_semver3.default.major(current) && (import_semver3.default.major(current) !== 0 || import_semver3.default.minor(v.version) === import_semver3.default.minor(current))).sort((a, b) => import_semver3.default.compare(a.version, b.version));
      if (!current || !fixed.length) {
        blocked.push(`${pkg.name}@${pkg.version}: ${advisory.id} has no supported same-major fixed version.`);
        continue;
      }
      const key = `${pkg.name}\0${pkg.version}`, previous = planned.get(key), candidate = fixed[0];
      planned.set(key, { name: pkg.name, from: pkg.version, to: previous && import_semver3.default.gt(comparableVersion(previous.to, pkg.ecosystem), candidate.version) ? previous.to : candidate.raw, advisories: [.../* @__PURE__ */ new Set([...previous?.advisories ?? [], advisory.id])] });
    }
    for (const [key, change] of planned) {
      if (!composer.some((p) => p.name === change.name)) continue;
      const from = comparableVersion(change.from, "composer");
      for (let round = 0; ; round++) {
        const to = comparableVersion(change.to, "composer");
        const still = packagistFor(change.name).filter((a) => a.constraint && affects(a.constraint, to));
        if (!still.length) break;
        const next = still.flatMap((a) => a.constraint.filter((alternative) => affects([alternative], to)).flatMap((alternative) => alternative.filter((t) => t.op === "<").map((t) => t.version))).filter((v) => import_semver3.default.gt(v, to) && import_semver3.default.major(v) === import_semver3.default.major(from) && (import_semver3.default.major(from) !== 0 || import_semver3.default.minor(v) === import_semver3.default.minor(from))).sort(import_semver3.default.compare);
        if (round >= 20 || !next.length) {
          planned.delete(key);
          blocked.push(`${change.name}@${change.from}: Packagist lists ${change.to} as affected (${still.map((a) => a.advisory.id).join(", ")}) and gives no supported same-major fixed version.`);
          break;
        }
        change.to = next.at(-1);
        change.advisories = [.../* @__PURE__ */ new Set([...change.advisories, ...still.map((a) => a.advisory.id)])];
      }
    }
    return { schema: 1, checked_at: (/* @__PURE__ */ new Date()).toISOString(), source: "https://osv.dev", sources: composer.length ? ["https://osv.dev", PACKAGIST_ADVISORIES] : ["https://osv.dev"], status: findings.length ? "vulnerabilities_found" : inventory2.limitations.length || unreadable.length ? "incomplete" : "no_known_vulnerabilities", inventory: inventory2, findings, plan: [...planned.values()], blocked: [.../* @__PURE__ */ new Set([...unreadable, ...blocked])], note: "Known advisories for the recorded package inventory only. No match is not a security guarantee. Package names and versions are sent to OSV, and Composer package names to Packagist; source is not. Major-version fixes, unresolved inventory and unsupported builds require review." };
  }
};

// src/security/acquisition.ts
var import_xmldom2 = __toESM(require_lib(), 1);
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
var MAVEN_SETTINGS = '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"><mirrors><mirror><id>ludion-central</id><mirrorOf>*</mirrorOf><url>https://repo.maven.apache.org/maven2</url></mirror></mirrors></settings>';
var PLUGIN_PARAMETERS = /* @__PURE__ */ new Set(["includes", "excludes", "scope", "verbose", "tokens", "outputType", "outputFile", "outputEncoding", "outputScope", "appendOutput", "skip", "silent", "outputDirectory", "excludeTransitive", "includeScope", "excludeScope", "includeGroupIds", "excludeGroupIds", "includeArtifactIds", "excludeArtifactIds", "includeTypes", "excludeTypes", "includeClassifiers", "excludeClassifiers"]);
function acquisitionPom(original) {
  const parsed = parsePom(original);
  const document = new import_xmldom2.DOMParser().parseFromString('<project xmlns="http://maven.apache.org/POM/4.0.0"/>', "application/xml");
  const allowed = /* @__PURE__ */ new Set(["modelVersion", "groupId", "artifactId", "version", "packaging", "dependencies", "dependencyManagement"]);
  const elements = Array.from(parsed.project.childNodes).filter((node) => node.nodeType === 1);
  const kept = elements.filter((node) => allowed.has(node.localName));
  const properties = elements.find((node) => node.localName === "properties");
  const values = /* @__PURE__ */ new Map();
  for (const node of Array.from(properties?.childNodes ?? [])) if (node.nodeType === 1) values.set(node.localName, node.textContent ?? "");
  const used = /* @__PURE__ */ new Set(), pending = kept.map((node) => node.textContent ?? "");
  while (pending.length) {
    for (const [, name] of pending.pop().matchAll(/\$\{([^}]+)\}/g)) {
      if (!name || used.has(name) || !values.has(name)) continue;
      if (PLUGIN_PARAMETERS.has(name) || name.startsWith("mdep.")) throw new Error(`Maven property ${name} is also a dependency-plugin parameter; it needs review.`);
      used.add(name);
      pending.push(values.get(name));
    }
  }
  const root = document.documentElement;
  for (const node of kept) root.appendChild(document.importNode(node, true));
  if (used.size) {
    const element = document.createElementNS(root.namespaceURI, "properties");
    for (const node of Array.from(properties.childNodes)) if (node.nodeType === 1 && used.has(node.localName)) element.appendChild(document.importNode(node, true));
    root.appendChild(element);
  }
  return new import_xmldom2.XMLSerializer().serializeToString(document);
}
function publicArchiveUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hash) throw new Error("Archive must use credential-free public HTTPS.");
  const sha = "[a-fA-F0-9]{40,64}";
  const patterns = {
    "api.github.com": new RegExp(`^/repos/[^/]+/[^/]+/(?:zipball|tarball)/${sha}/?$`),
    "codeload.github.com": new RegExp(`^/[^/]+/[^/]+/(?:legacy\\.zip|zip|legacy\\.tar\\.gz|tar\\.gz)/${sha}/?$`),
    "github.com": new RegExp(`^/[^/]+/[^/]+/archive/${sha}\\.(?:zip|tar\\.gz)$`),
    "bitbucket.org": new RegExp(`^/[^/]+/[^/]+/get/${sha}\\.zip$`)
  };
  if (!patterns[url.hostname]?.test(url.pathname) || url.search) throw new Error("Archive origin/path is outside the public pinned-archive policy.");
  return url;
}
async function localComposerLock(exported, destination, cache, fetchFn = fetch, signal) {
  const active = () => {
    if (signal?.aborted) throw new Error("Archive acquisition cancelled.");
  };
  active();
  mkdirSync2(destination, { recursive: true });
  mkdirSync2(cache, { recursive: true });
  const lock = jsonFile(exported, "composer.lock"), evidence = [];
  let total = 0;
  for (const pkg of [...lock.packages, ...lock["packages-dev"] ?? []]) {
    active();
    if (pkg.dist?.type !== "zip" || typeof pkg.dist.url !== "string") throw new Error("Composer adapter currently requires pinned public ZIP distributions.");
    const original = publicArchiveUrl(pkg.dist.url).href, key = hash(original), cached = join4(cache, key);
    let bytes, final = original;
    if (existsSync4(cached)) {
      bytes = readFileSync4(cached);
      const metadata = JSON.parse(readFileSync4(`${cached}.json`, "utf8"));
      final = publicArchiveUrl(metadata.final_url).href;
      if (metadata.sha256 !== hash(bytes)) throw new Error("Archive cache checksum mismatch.");
    } else {
      for (let hop = 0; ; hop++) {
        if (hop > 5) throw new Error("Too many archive redirects.");
        active();
        const url = publicArchiveUrl(final);
        const controller = new AbortController(), stop = () => controller.abort();
        const timeout = setTimeout(stop, 6e4);
        signal?.addEventListener("abort", stop, { once: true });
        try {
          const response = await fetchFn(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Ludion-Security-Preview", "accept": "application/zip" } });
          active();
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw new Error("Archive redirect has no location.");
            final = publicArchiveUrl(new URL(location, url).href).href;
            continue;
          }
          if (!response.ok || !response.body) throw new Error(`Archive download failed (HTTP ${response.status}).`);
          const reader = response.body.getReader(), chunks = [];
          let size = 0;
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              size += result.value.length;
              if (size > 32 * 1024 * 1024) throw new Error("Archive exceeds 32 MiB.");
              chunks.push(result.value);
            }
          } finally {
            await reader.cancel().catch(() => {
            });
          }
          bytes = Buffer.concat(chunks);
          active();
          writeFileSync3(cached, bytes, { flag: "wx", mode: 384 });
          writeFileSync3(`${cached}.json`, JSON.stringify({ final_url: final, sha256: hash(bytes) }), { flag: "wx", mode: 384 });
          break;
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", stop);
        }
      }
    }
    active();
    total += bytes.length;
    if (total > 100 * 1024 * 1024) throw new Error("Composer archive set exceeds 100 MiB.");
    if (pkg.dist.shasum && (!/^[a-f0-9]{40}$/i.test(pkg.dist.shasum) || createHash2("sha1").update(bytes).digest("hex") !== pkg.dist.shasum.toLowerCase())) throw new Error("Composer archive checksum mismatch.");
    const digest = hash(bytes), name = `${digest}.zip`;
    if (!existsSync4(join4(destination, name))) writeFileSync3(join4(destination, name), bytes, { flag: "wx", mode: 420 });
    evidence.push({ url: original, final_url: final, sha256: digest, bytes: bytes.length });
    pkg.dist = { ...pkg.dist, url: `file:///archives/${name}`, shasum: createHash2("sha1").update(bytes).digest("hex") };
    delete pkg.source;
  }
  writeFileSync3(join4(destination, "composer.lock"), `${JSON.stringify(lock, null, 2)}
`);
  return evidence;
}

// src/security/judge.ts
var import_semver4 = __toESM(require_semver2(), 1);

// src/security/time-cap.ts
var SAME_RELEASE_MINUTES = 15;
function sameRelease(target, other, t) {
  const a = target.identity.provenance, b = other.identity.provenance;
  if (a && b) return a.repository && a.workflow && a.commit && a.repository === b.repository && a.workflow === b.workflow && a.commit === b.commit ? "provenance" : null;
  if (a || b) return null;
  const within = other.published >= t && other.published - target.published <= SAME_RELEASE_MINUTES * 6e4;
  return target.identity.publisher && target.identity.publisher === other.identity.publisher && target.version === other.version && within ? "publisher" : null;
}
function timeCap(input) {
  const out = { t: null, targets: input.targets.map((r) => `${r.name}@${r.version}`).sort(), after_t: [], same_release: [], young: [], undecidable: [], wait_hours: input.waitHours };
  if (!input.targets.length) {
    out.undecidable.push("The change names no fixed package and no direct dependency, so T (the fix's publish time) is unknown.");
    return out;
  }
  let t = -Infinity;
  for (const r of input.targets) {
    const at = Date.parse(input.published(r.name, r.version) ?? "");
    if (!Number.isFinite(at)) {
      out.undecidable.push(`${r.name}@${r.version} has no publish time, so T is unknown.`);
      continue;
    }
    t = Math.max(t, at);
  }
  if (out.undecidable.length) return out;
  out.t = new Date(t).toISOString();
  const targets = new Set(out.targets);
  for (const r of input.others) {
    const id = `${r.name}@${r.version}`;
    if (targets.has(id) || input.locked.has(id)) continue;
    const at = Date.parse(input.published(r.name, r.version) ?? "");
    if (!Number.isFinite(at)) {
      out.undecidable.push(`${id} has no publish time; it cannot be checked against T.`);
      continue;
    }
    if (at < t || out.after_t.includes(id) || out.same_release.some((s) => s.version === id)) continue;
    const identity = input.identity?.(r.name, r.version);
    const sibling = identity && input.targets.map((target) => {
      const own = input.identity(target.name, target.version);
      const basis = own && sameRelease({ version: target.version, published: Date.parse(input.published(target.name, target.version)), identity: own }, { version: r.version, published: at, identity }, t);
      return basis ? { version: id, target: `${target.name}@${target.version}`, basis } : null;
    }).find((s) => s !== null);
    if (sibling) out.same_release.push(sibling);
    else out.after_t.push(id);
  }
  for (const name of [...new Set(input.newDependencies)].sort()) {
    const at = Date.parse(input.created(name) ?? "");
    if (!Number.isFinite(at)) out.undecidable.push(`The first publish of ${name}, a new dependency, is unknown.`);
    else if (at > t - input.waitHours * 36e5) out.young.push(`${name} (first published ${new Date(at).toISOString()})`);
  }
  out.after_t = [...new Set(out.after_t)].sort();
  out.same_release.sort((a, b) => a.version.localeCompare(b.version));
  return out;
}
function renderTimeCap(cap) {
  const lines = [`Published at or after T (${cap.t ?? "unknown"}, the fix's publish time): ${cap.t ? cap.after_t.length + cap.same_release.length : "unknown"} version(s)`];
  for (const v of cap.after_t) lines.push(`  ${v}`);
  for (const s of cap.same_release) lines.push(`  ${s.version}: allowed, the same release as ${s.target} (${s.basis === "provenance" ? "provenance names the same repository, workflow and commit" : `no provenance; same publisher and version, at most ${SAME_RELEASE_MINUTES} minutes after it`})`);
  return lines;
}
async function boundedJson(fetchFn, url, maxBytes) {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(3e4), headers: { accept: "application/json", "user-agent": "Ludion-Security-Preview" } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {
    });
    throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}; the time cap cannot be checked.`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty response from ${new URL(url).hostname}.`);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      size += value2.length;
      if (size > maxBytes) throw new Error(`Response from ${new URL(url).hostname} exceeds ${maxBytes} bytes.`);
      chunks.push(value2);
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function firstPublish(time) {
  const times = Object.entries(time).filter(([key, at]) => key !== "modified" && key !== "unpublished" && typeof at === "string").map(([, at]) => Date.parse(at)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
var NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
async function npmReleases(name, fetchFn = fetch) {
  if (!NPM_NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`);
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const doc = await boundedJson(fetchFn, `https://registry.npmjs.org/${path}`, 64 * 1024 * 1024);
  if (!doc || typeof doc.time !== "object" || typeof doc.versions !== "object") throw new Error(`Invalid registry document for ${name}.`);
  const published = /* @__PURE__ */ new Map(), requires = /* @__PURE__ */ new Map();
  for (const [version2, at] of Object.entries(doc.time)) if (version2 !== "created" && version2 !== "modified" && typeof at === "string") published.set(version2, at);
  for (const [version2, manifest] of Object.entries(doc.versions)) requires.set(version2, Object.keys({ ...manifest?.dependencies, ...manifest?.optionalDependencies }).sort());
  return { created: firstPublish(doc.time), published, requires };
}
var COMPOSER_NAME = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/;
var composerVersion = (version2) => version2.replace(/^v(?=\d)/, "");
async function packagistReleases(name, fetchFn = fetch) {
  if (!COMPOSER_NAME.test(name)) throw new Error(`Invalid Composer package name: ${name}`);
  const doc = await boundedJson(fetchFn, `https://repo.packagist.org/p2/${name}.json`, 32 * 1024 * 1024);
  const list = doc?.packages?.[name];
  if (!Array.isArray(list)) throw new Error(`Invalid Packagist metadata for ${name}.`);
  const published = /* @__PURE__ */ new Map(), requires = /* @__PURE__ */ new Map();
  let current = {};
  for (const entry of list) {
    if (!entry || typeof entry !== "object") throw new Error(`Invalid Packagist metadata for ${name}.`);
    current = doc.minified === "composer/2.0" ? { ...current } : {};
    for (const [key, value2] of Object.entries(entry)) {
      if (value2 === "__unset") delete current[key];
      else current[key] = value2;
    }
    if (typeof current.version !== "string") throw new Error(`Invalid Packagist metadata for ${name}.`);
    const version2 = composerVersion(current.version);
    if (typeof current.time === "string") published.set(version2, current.time);
    const require2 = current.require && typeof current.require === "object" ? Object.keys(current.require).filter((r) => r.includes("/")) : [];
    requires.set(version2, require2.sort());
  }
  const times = [...published.values()].map(Date.parse).filter(Number.isFinite);
  return { created: times.length ? new Date(Math.min(...times)).toISOString() : null, published, requires };
}

// src/security/judge.ts
var WAIT_HOURS = { exploited: 12, high: 24, normal: 72, low: 168 };
var EXPLOITED_UNCOMPARABLE_HOURS = 24;
var EXTENDED_MIN_HOURS = 72;
var releaseIdentity = (f) => ({ publisher: f.shared_publisher ? null : f.publisher, provenance: f.provenance });
function registryTarball(name, version2) {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version2}.tgz`;
}
function ownFixes(fixes) {
  const smallest = /* @__PURE__ */ new Map();
  for (const f of fixes) {
    const key = `${f.id}\0${f.package}\0${f.from}`, s = smallest.get(key);
    if (!s || import_semver4.default.lt(f.to, s.to)) smallest.set(key, f);
  }
  return fixes.filter((f) => smallest.get(`${f.id}\0${f.package}\0${f.from}`).to === f.to);
}
var fixedBy = (fixes) => {
  const own = new Set(ownFixes(fixes).map((f) => `${f.package}@${f.to}`));
  return (c) => own.has(`${c.name}@${c.to}`);
};
var LIFECYCLE = ["preinstall", "install", "postinstall"];
function installScripts(scripts) {
  if (!scripts || typeof scripts !== "object") return [];
  return LIFECYCLE.filter((name) => typeof scripts[name] === "string");
}
function readLock(lockText) {
  const lock = JSON.parse(lockText);
  if (!lock.packages || typeof lock.packages !== "object" || ![2, 3].includes(Number(lock.lockfileVersion))) throw new Error("The judge reads package-lock v2/v3 only.");
  return lock.packages;
}
var LOCK_PATH = /^(?:[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*\/)?(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+$/i;
var requireName = (path) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
function lockEntries(lockText) {
  const entries = [];
  const folded = /* @__PURE__ */ new Set();
  for (const [path, item] of Object.entries(readLock(lockText))) {
    if (folded.has(path.toLowerCase())) throw new Error(`Two package-lock paths differ only in case: ${path}.`);
    folded.add(path.toLowerCase());
    if (path.includes("\\")) throw new Error(`Unexpected package-lock path: ${path}.`);
    if (!path.includes("node_modules/")) continue;
    if (!LOCK_PATH.test(path) || path.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`Unexpected package-lock path: ${path}.`);
    if (item?.link) continue;
    const name = typeof item.name === "string" ? item.name : requireName(path);
    if (typeof item.version !== "string" || !import_semver4.default.valid(item.version)) throw new Error(`Invalid locked version at ${path}.`);
    entries.push({ path, name, version: item.version, dev: item.dev === true, bundled: item.inBundle === true, resolved: typeof item.resolved === "string" ? item.resolved : null, integrity: typeof item.integrity === "string" ? item.integrity : null });
  }
  return entries;
}
function lockLinks(lockText) {
  return Object.entries(readLock(lockText)).filter(([path, item]) => path.includes("node_modules/") && item?.link).map(([path, item]) => `${path} -> ${String(item.resolved)}`).sort();
}
function lockEntryChanges(before, after) {
  const atPath = new Map(before.map((e) => [e.path, e]));
  return after.filter((e) => {
    const b = atPath.get(e.path);
    return !b || b.name !== e.name || b.version !== e.version || b.resolved !== e.resolved || b.integrity !== e.integrity;
  });
}
function resolveFrom(entries, dir, name) {
  let at = dir;
  while (true) {
    const found = entries.get(`${at}node_modules/${name}`);
    if (found || !at) return found;
    const up = at.replace(/node_modules\/(?:@[^/]+\/)?[^/]+\/$/, "");
    at = up === at ? "" : up;
  }
}
function lockDiff(before, after) {
  const atPath = new Map(before.map((e) => [e.path, e])), afterAt = new Map(after.map((e) => [e.path, e]));
  const changes = /* @__PURE__ */ new Map();
  const add2 = (entry, from, previous, replaced) => {
    const key = `${entry.name}\0${previous}\0${entry.version}\0${replaced}\0${entry.integrity}`;
    const existing = changes.get(key);
    changes.set(key, existing ? { ...existing, dev: existing.dev && entry.dev } : { path: from?.path ?? entry.path, name: entry.name, from: previous, to: entry.version, dev: entry.dev, resolved: entry.resolved, integrity: entry.integrity, replaced });
  };
  for (const entry of after) {
    const samePath = atPath.get(entry.path);
    if (samePath && samePath.name === entry.name && samePath.version === entry.version && samePath.integrity === entry.integrity) continue;
    const replaced = samePath && samePath.name !== entry.name ? `${samePath.name}@${samePath.version}` : null;
    const previous = samePath?.name === entry.name ? samePath.version : before.filter((e) => e.name === entry.name && import_semver4.default.major(e.version) === import_semver4.default.major(entry.version)).map((e) => e.version).sort(import_semver4.default.rcompare)[0] ?? null;
    if (!replaced && !samePath && previous === entry.version && before.some((e) => e.name === entry.name && e.version === entry.version && e.integrity === entry.integrity)) continue;
    add2(entry, void 0, previous, replaced);
  }
  for (const gone of before) {
    if (afterAt.has(gone.path)) continue;
    const dependent = gone.path.slice(0, gone.path.lastIndexOf("node_modules/"));
    if (dependent.includes("node_modules/") && !afterAt.has(dependent.replace(/\/$/, ""))) continue;
    const now = resolveFrom(afterAt, dependent, requireName(gone.path));
    if (!now || now.name === gone.name && now.version === gone.version && now.integrity === gone.integrity) continue;
    add2(now, gone, now.name === gone.name ? gone.version : null, now.name === gone.name ? null : `${gone.name}@${gone.version}`);
  }
  return [...changes.values()].sort((a, b) => a.name.localeCompare(b.name) || import_semver4.default.compare(a.to, b.to) || a.path.localeCompare(b.path));
}
function declaredByProject(lockText) {
  return [...new Set(consumers(lockText).filter((c) => c.path === "" || !c.path.includes("node_modules/")).flatMap((c) => c.requires))].sort();
}
var DECLARED = ["dependencies", "optionalDependencies", "peerDependencies"];
function consumers(lockText) {
  const out = [];
  for (const [path, item] of Object.entries(readLock(lockText))) {
    if (!item || typeof item !== "object" || item.link) continue;
    const own = path === "" || !path.includes("node_modules/");
    const groups = own ? [...DECLARED, "devDependencies"] : DECLARED;
    const requires = [...new Set(groups.flatMap((group) => item[group] && typeof item[group] === "object" ? Object.keys(item[group]) : []))].sort();
    const name = own ? `<${path || "root"}>` : typeof item.name === "string" ? item.name : requireName(path);
    out.push({ path, name, dir: path ? `${path}/` : "", requires });
  }
  return out;
}
function resolutionChanges(beforeText, afterText) {
  const resolve4 = (text) => {
    const entries = new Map(lockEntries(text).map((e) => [e.path, e]));
    const byPath = /* @__PURE__ */ new Map(), byName = /* @__PURE__ */ new Map(), names = /* @__PURE__ */ new Map();
    for (const c of consumers(text)) {
      names.set(c.path, c.name);
      for (const name of c.requires) {
        const target = resolveFrom(entries, c.dir, name);
        if (!target) continue;
        byPath.set(`${c.path}\0${name}`, target);
        byName.set(`${c.name}\0${name}`, [...byName.get(`${c.name}\0${name}`) ?? [], target]);
      }
    }
    return { byPath, byName, names, consumers: consumers(text) };
  };
  const before = resolve4(beforeText), after = resolve4(afterText);
  const changes = /* @__PURE__ */ new Map();
  for (const c of after.consumers) for (const name of c.requires) {
    const target = after.byPath.get(`${c.path}\0${name}`);
    if (!target) continue;
    const samePlace = before.names.get(c.path) === c.name;
    const was = samePlace ? [before.byPath.get(`${c.path}\0${name}`)].filter((t) => !!t) : before.byName.get(`${c.name}\0${name}`) ?? [];
    if (!was.length) continue;
    const same = (w) => w.name === target.name && w.version === target.version && w.integrity === target.integrity;
    if (samePlace ? same(was[0]) : was.every(same)) continue;
    for (const w of was) {
      if (same(w)) continue;
      const from = w.name === target.name ? w.version : null;
      const replaced = w.name === target.name ? null : `${w.name}@${w.version}`;
      const id = `${target.name}\0${from}\0${target.version}\0${replaced}\0${target.integrity}`;
      const existing = changes.get(id);
      changes.set(id, existing ? { ...existing, dev: existing.dev && target.dev } : { path: target.path, name: target.name, from, to: target.version, dev: target.dev, resolved: target.resolved, integrity: target.integrity, replaced });
    }
  }
  return [...changes.values()];
}
function allChanges(beforeText, afterText) {
  const merged = /* @__PURE__ */ new Map();
  for (const c of [...lockDiff(lockEntries(beforeText), lockEntries(afterText)), ...resolutionChanges(beforeText, afterText)]) {
    const key = `${c.name}\0${c.from}\0${c.to}\0${c.replaced}\0${c.integrity}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, dev: existing.dev && c.dev } : c);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || import_semver4.default.compare(a.to, b.to) || a.path.localeCompare(b.path));
}
var DEPENDENCY_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
function registrySpec(spec) {
  if (typeof spec !== "string") return false;
  const alias = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(.+)$/i.exec(spec);
  return !!import_semver4.default.validRange(alias ? alias[2] : spec);
}
function manifestChanges(before, after) {
  const b = before ?? {}, a = after ?? {};
  if (typeof after !== "object" || after === null || Array.isArray(after)) return ["package.json is not an object."];
  const out = [];
  for (const key of [.../* @__PURE__ */ new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    if (key === "overrides") {
      const specs = [];
      const walk = (value2) => {
        if (value2 && typeof value2 === "object") Object.values(value2).forEach(walk);
        else specs.push(value2);
      };
      walk(a[key]);
      if (specs.some((spec) => !(typeof spec === "string" && (spec.startsWith("$") || registrySpec(spec))))) out.push("package.json overrides point outside the npm registry.");
      continue;
    }
    if (!DEPENDENCY_GROUPS.includes(key)) {
      out.push(`package.json changes "${key}", which is not a dependency list (scripts, for one, run on install).`);
      continue;
    }
    if (a[key] !== void 0 && (typeof a[key] !== "object" || a[key] === null || Array.isArray(a[key]))) {
      out.push(`package.json ${key} is not an object of name: range.`);
      continue;
    }
    const group = a[key] ?? {}, old = b[key] ?? {};
    for (const [name, spec] of Object.entries(group)) if (spec !== old[name] && !registrySpec(spec)) out.push(`package.json ${key}.${name} is "${String(spec)}", not a registry range.`);
  }
  return out;
}
function urgencyOf(fixes, changes, epssHigh = 0.1) {
  const fixes_ = (c, f) => c.name === f.package && c.from === f.from && c.to === f.to;
  const fixed = fixes.filter((f) => changes.some((c) => fixes_(c, f)));
  const fixing = changes.filter((c) => fixed.some((f) => fixes_(c, f)) && !c.dev);
  if (!changes.some((c) => !c.dev)) return "low";
  if (!fixing.length) return "normal";
  const urgent = fixed.filter((f) => fixing.some((c) => fixes_(c, f)));
  if (urgent.some((f) => f.kev)) return "exploited";
  if (urgent.some((f) => f.severity?.toUpperCase() === "CRITICAL" || f.epss !== null && f.epss >= epssHigh)) return "high";
  return "normal";
}
function judge(input) {
  const { changes, facts, fixes, now } = input;
  const findings = [];
  const add2 = (finding) => findings.push(finding);
  const urgency = urgencyOf(fixes, changes);
  let undecidable = false;
  for (const error of input.errors ?? []) {
    add2({ gate: 2, effect: "stop", message: `A lookup failed: ${error.slice(0, 300)}` });
    undecidable = true;
  }
  if (!changes.length && !(input.links ?? []).length) {
    add2({ gate: 1, effect: "info", message: "The lockfile change adds no package version." });
    undecidable = true;
  }
  const lockName = input.lockfile === "pnpm-lock" ? "pnpm-lock.yaml" : "package-lock.json";
  if (input.files === null || !input.files.includes(lockName)) {
    add2({ gate: 4, effect: "info", message: input.files === null ? `The PR's changed files were not given (--files), so gate 4 could not check that only package.json and ${lockName} change.` : `The given changed files do not include ${lockName}, although the lockfile changed.` });
    undecidable = true;
  } else {
    const unexpected = input.files.filter((f) => !["package.json", lockName].includes(f));
    if (unexpected.length) add2({ gate: 4, effect: "stop", message: `The change also touches ${unexpected.join(", ")}; a dependency update must change only package.json and ${lockName}.` });
  }
  if (input.lockfile === "pnpm-lock") {
    add2({ gate: 4, effect: "info", message: "pnpm-lock.yaml is read as the set of versions it adds: each entry's tarball and hash, and what each dependent loads, are not checked for pnpm." });
    undecidable = true;
  }
  if (input.manifest) for (const message of manifestChanges(input.manifest.before, input.manifest.after)) add2({ gate: 4, effect: "stop", message });
  for (const link of input.links ?? []) add2({ gate: 4, effect: "stop", message: `${link}: a link to a local directory that is new or points elsewhere, instead of a registry package.` });
  const entries = input.lockfile === "pnpm-lock" ? [] : input.entries ?? changes.map((c) => ({ path: c.path, name: c.name, version: c.to, dev: c.dev, resolved: c.resolved, integrity: c.integrity }));
  for (const e of entries) {
    const where = `${e.name}@${e.version} at ${e.path}`;
    if (e.bundled) {
      add2({ gate: 4, package: e.name, effect: "stop", message: `${where} is bundled inside its parent and has no registry tarball of its own; a change to a bundled dependency needs review.` });
      continue;
    }
    if (e.resolved !== registryTarball(e.name, e.version)) add2({ gate: 4, package: e.name, effect: "stop", message: `${where} resolves to ${e.resolved ?? "nothing"}, not the registry's tarball ${registryTarball(e.name, e.version)}.` });
    const fact = facts.get(`${e.name}@${e.version}`);
    if (!e.integrity?.startsWith("sha512-")) add2({ gate: 4, package: e.name, effect: "stop", message: `${where} has no sha512 integrity in the lockfile.` });
    else if (!fact) {
      add2({ gate: 4, package: e.name, effect: "stop", message: `No registry facts to check the integrity of ${where}; undecidable.` });
      undecidable = true;
    } else if (fact.integrity !== e.integrity) add2({ gate: 4, package: e.name, effect: "stop", message: `${where}: the lockfile integrity is not the registry's (${fact.integrity ?? "none"}).` });
  }
  let comparable = changes.length > 0, extended = false;
  let newest = null;
  for (const c of changes) {
    const next = facts.get(`${c.name}@${c.to}`);
    const prev = c.from ? facts.get(`${c.name}@${c.from}`) : void 0;
    if (!next || c.from && !prev) {
      add2({ gate: 2, package: c.name, effect: "stop", message: `No registry facts for ${c.name}@${c.to}${c.from ? ` or ${c.from}` : ""}; undecidable.` });
      undecidable = true;
      comparable = false;
      continue;
    }
    if (!next.published_at || !Number.isFinite(Date.parse(next.published_at))) {
      add2({ gate: "wait", package: c.name, effect: "stop", message: `${c.name}@${c.to} has no publish time; the wait cannot be measured.` });
      undecidable = true;
    } else if (!newest || Date.parse(next.published_at) > Date.parse(newest)) newest = next.published_at;
    if (next.malicious.length) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is in OSV's malicious-package records (${next.malicious.join(", ")}).` });
    if (!next.present) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is no longer listed by the registry (unpublished or withdrawn).` });
    if (next.deprecated) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is deprecated: ${next.deprecated.slice(0, 200)}` });
    if (c.replaced) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.path} now installs ${c.name}@${c.to} instead of ${c.replaced}: another package under the same name.` });
    if (c.from && import_semver4.default.lt(c.to, c.from)) add2({ gate: 1, package: c.name, effect: "stop", message: `${c.name} goes down from ${c.from} to ${c.to} at ${c.path}.` });
    const introduced = next.advisories.filter((id) => !prev?.advisories.includes(id));
    if (introduced.length) add2({ gate: 1, package: c.name, effect: "stop", message: `${c.name}@${c.to} has known advisories ${c.from ? `that ${c.from} did not have` : "and is new to the project"}: ${introduced.join(", ")}.` });
    const remaining = next.advisories.filter((id) => prev?.advisories.includes(id));
    if (remaining.length) add2({ gate: 1, package: c.name, effect: "info", message: `${c.name}@${c.to} still has known advisories: ${remaining.join(", ")}.` });
    if (!prev || !prev.present) {
      add2({ gate: 2, package: c.name, effect: "extend", message: prev ? `${c.name}@${c.from}, the version it replaces, is no longer listed; there is nothing to compare with.` : `${c.name} is new to the project; there is no earlier version to compare with.` });
      extended = true;
      comparable = false;
      if (next.install_scripts.length) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} has no comparable predecessor and runs install scripts (${next.install_scripts.join(", ")}).` });
      continue;
    }
    if (prev.provenance && !next.provenance) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.from} had build provenance and ${c.to} has none.` });
    else if (prev.provenance && next.provenance && (prev.provenance.repository !== next.provenance.repository || prev.provenance.workflow !== next.provenance.workflow)) {
      add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} was built from ${next.provenance.repository ?? "?"} ${next.provenance.workflow ?? "?"}, not ${prev.provenance.repository ?? "?"} ${prev.provenance.workflow ?? "?"} like ${c.from}.` });
    }
    if (!prev.provenance?.repository || !prev.provenance.workflow || !next.provenance?.repository || !next.provenance.workflow) comparable = false;
    const added = next.install_scripts.filter((s) => !prev.install_scripts.includes(s));
    if (added.length) add2({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} adds install scripts: ${added.join(", ")}.` });
    if (prev.publisher !== next.publisher) {
      add2({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} was published by ${next.publisher ?? "unknown"}, ${c.from} by ${prev.publisher ?? "unknown"}.` });
      extended = true;
    }
    const newDeps = next.dependencies.filter((d) => !prev.dependencies.includes(d));
    if (newDeps.length) {
      add2({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} adds dependencies: ${newDeps.join(", ")}.` });
      extended = true;
    }
  }
  const locked = input.locked ?? new Set(changes.flatMap((c) => c.from ? [`${c.name}@${c.from}`] : []));
  const lockedNames = new Set([...locked].map((id) => id.slice(0, id.lastIndexOf("@"))));
  let targets = changes.filter(fixedBy(fixes));
  if (!targets.length) targets = changes.filter((c) => (input.direct ?? []).includes(c.name));
  const newDependencies = changes.flatMap((c) => {
    const next = facts.get(`${c.name}@${c.to}`), prev = c.from ? facts.get(`${c.name}@${c.from}`) : void 0;
    return [...next && prev?.present ? next.dependencies.filter((d) => !prev.dependencies.includes(d)) : [], ...lockedNames.has(c.name) ? [] : [c.name]];
  });
  const created = new Map(input.created ?? []);
  for (const [id, f] of facts) if (f.package_created !== void 0 && !created.has(id.slice(0, id.lastIndexOf("@")))) created.set(id.slice(0, id.lastIndexOf("@")), f.package_created);
  const cap = timeCap({
    targets: targets.map((c) => ({ name: c.name, version: c.to })),
    others: changes.map((c) => ({ name: c.name, version: c.to })),
    locked,
    newDependencies,
    published: (name, version2) => facts.get(`${name}@${version2}`)?.published_at,
    created: (name) => created.get(name),
    identity: (name, version2) => {
      const f = facts.get(`${name}@${version2}`);
      return f && releaseIdentity(f);
    },
    waitHours: WAIT_HOURS[urgency]
  });
  if (changes.length) {
    for (const reason of cap.undecidable) {
      add2({ gate: 2, effect: "stop", message: `Time cap: ${reason}` });
      undecidable = true;
    }
    for (const id of cap.after_t) add2({ gate: 2, package: id.slice(0, id.lastIndexOf("@")), effect: "stop", message: `${id} was published at or after the fix (T = ${cap.t}); only versions already locked or published before T may move with it.` });
    for (const young of cap.young) add2({ gate: 2, effect: "stop", message: `New dependency ${young}: the package first appeared less than ${cap.wait_hours}h before the fix (T = ${cap.t}).` });
  }
  let wait = WAIT_HOURS[urgency];
  if (urgency === "exploited" && !comparable) wait = EXPLOITED_UNCOMPARABLE_HOURS;
  if (extended) wait = Math.max(wait * 2, EXTENDED_MIN_HOURS);
  const stricter = input.projectWait?.[urgency];
  if (stricter !== void 0 && stricter > wait) wait = stricter;
  const waitUntil = newest ? new Date(Date.parse(newest) + wait * 36e5).toISOString() : null;
  const stopped = findings.some((f) => f.effect === "stop");
  const verdict = undecidable ? "undecidable" : stopped ? "stop" : waitUntil && now.getTime() < Date.parse(waitUntil) ? "wait" : "ready_except_build";
  const fixing = changes.filter(fixedBy(fixes)).map((c) => facts.get(`${c.name}@${c.to}`)?.published_at).filter((t) => !!t).sort();
  return {
    schema: 1,
    judged_at: now.toISOString(),
    verdict,
    urgency,
    wait_hours: wait,
    newest_publish: newest,
    wait_until: waitUntil,
    changes,
    fixes,
    findings,
    exposure: { fix_published_at: fixing.at(-1) ?? null, detected_at: now.toISOString() },
    time_cap: cap,
    not_checked: [
      "Gate 3 (build and tests of old and new versions) is not run by the judge v0.",
      "Obfuscated code and new network or process calls in the changed code are not inspected.",
      "Gate 1's OS, SAPI and configuration conditions are not matched; only production versus dev-only is used.",
      "Provenance is read from the registry's attestation record and must name the version and its tarball hash; its Sigstore signature and certificate are not verified here, so provenance (and the same-release exception that relies on it) rests on the registry's checks at publish time.",
      "A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).",
      "The lockfile is read as npm 7 or later reads it (`packages`); the legacy `dependencies` section of a v2 lockfile is not compared.",
      "A dependency newly required by a package (nothing satisfied it before) is not compared when it lands on a copy that was already installed; that copy's own advisories are not reported for it."
    ]
  };
}
function renderJudgement(j) {
  const head = { stop: "Ludion judgement: STOP \u2014 not applied automatically", wait: `Ludion judgement: wait until ${j.wait_until}`, ready_except_build: "Ludion judgement: gates 1, 2 and 4 found nothing and the wait is over \u2014 build/test gate not run (v0)", undecidable: "Ludion judgement: undecidable \u2014 not applied automatically" }[j.verdict];
  const lines = [head, `Urgency: ${j.urgency} \xB7 wait ${j.wait_hours}h from the newest publish (${j.newest_publish ?? "unknown"})`, ...renderTimeCap(j.time_cap)];
  lines.push(`Changed packages (${j.changes.length}):`);
  for (const c of j.changes) lines.push(`  ${c.name} ${c.from ?? "(new)"} \u2192 ${c.to}${c.dev ? " (dev)" : ""}${c.replaced ? ` (replaces ${c.replaced} at ${c.path})` : ""}`);
  if (j.fixes.length) lines.push(`Fixes: ${[...new Set(j.fixes.map((f) => f.id))].join(", ")}`);
  const order = { stop: 0, extend: 1, info: 2 };
  for (const f of [...j.findings].sort((a, b) => order[a.effect] - order[b.effect])) lines.push(`  [${f.effect}] gate ${f.gate}: ${f.message}`);
  if (!j.findings.length) lines.push("  No gate finding.");
  lines.push("Not checked:");
  for (const n of j.not_checked) lines.push(`  - ${n}`);
  lines.push(`Exposure: fix published ${j.exposure.fix_published_at ?? "n/a"} \xB7 seen ${j.exposure.detected_at}`);
  return lines.join("\n");
}

// src/security/npm-facts.ts
async function boundedJson2(fetchFn, url, init = {}, maxBytes = 64 * 1024 * 1024) {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(3e4), ...init, headers: { accept: "application/json", "user-agent": "Ludion-Judge", ...init.headers ?? {} } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {
    });
    throw Object.assign(new Error(`${new URL(url).hostname} answered HTTP ${res.status}.`), { status: res.status });
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty response from ${new URL(url).hostname}.`);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      size += value2.length;
      if (size > maxBytes) throw new Error(`Response from ${new URL(url).hostname} exceeds ${maxBytes} bytes.`);
      chunks.push(value2);
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
var NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
var registryPath = (name) => {
  if (!NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`);
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
};
var COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var commitOf = (digest, key) => {
  const value2 = digest?.[key];
  return typeof value2 === "string" && COMMIT.test(value2) ? value2 : null;
};
var withoutRef = (uri) => {
  const u = uri.replace(/^git\+/, ""), path = u.indexOf("/", u.indexOf("://") + 3), at = path > 0 ? u.indexOf("@", path) : -1;
  return at > path ? u.slice(0, at) : u;
};
function provenanceFrom(attestations, subject) {
  const list = attestations?.attestations;
  if (!Array.isArray(list)) throw new Error("Invalid attestations record.");
  const slsa = list.find((a) => typeof a?.predicateType === "string" && a.predicateType.startsWith("https://slsa.dev/provenance/"));
  if (!slsa) return null;
  const payload = slsa.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== "string") throw new Error("Provenance attestation has no payload.");
  const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  if (subject) {
    const purl = `pkg:npm/${subject.name.replace(/^@/, "%40")}@${subject.version}`;
    const sha512 = subject.integrity?.startsWith("sha512-") ? Buffer.from(subject.integrity.slice(7), "base64").toString("hex") : null;
    if (!sha512 || !Array.isArray(statement?.subject) || !statement.subject.some((s) => s?.name === purl && s?.digest?.sha512 === sha512)) throw new Error(`The provenance statement does not name ${subject.name}@${subject.version} and its tarball.`);
  }
  const predicate = statement?.predicate;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  const resolved = predicate?.buildDefinition?.resolvedDependencies;
  const v1Commit = Array.isArray(resolved) ? commitOf(resolved[0]?.digest, "gitCommit") : null;
  if (workflow) return { repository: typeof workflow.repository === "string" ? workflow.repository : null, workflow: typeof workflow.path === "string" ? workflow.path : null, commit: v1Commit };
  const source = predicate?.invocation?.configSource;
  if (source) return { repository: typeof source.uri === "string" ? withoutRef(source.uri) : null, workflow: typeof source.entryPoint === "string" ? source.entryPoint : null, commit: commitOf(source.digest, "sha1") };
  return { repository: null, workflow: null, commit: v1Commit };
}
var sharedPublisher = (npmUser) => !!npmUser?.trustedPublisher || typeof npmUser?.email === "string" && npmUser.email.startsWith("npm-oidc-no-reply@") || typeof npmUser?.name === "string" && !/^[a-z0-9][a-z0-9._-]*$/.test(npmUser.name);
async function registryFacts(name, versions, fetchFn = fetch) {
  const doc = await boundedJson2(fetchFn, `https://registry.npmjs.org/${registryPath(name)}`);
  if (!doc || typeof doc !== "object" || typeof doc.versions !== "object" || typeof doc.time !== "object") throw new Error(`Invalid registry document for ${name}.`);
  const facts = /* @__PURE__ */ new Map();
  const created = firstPublish(doc.time);
  for (const version2 of versions) {
    const manifest = doc.versions[version2];
    const published = typeof doc.time[version2] === "string" ? doc.time[version2] : null;
    if (!manifest) {
      facts.set(version2, { published_at: published, present: false, deprecated: null, publisher: null, shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: null, package_created: created });
      continue;
    }
    const integrity = typeof manifest.dist?.integrity === "string" ? manifest.dist.integrity : null;
    let provenance = null;
    if (manifest.dist?.attestations) {
      provenance = provenanceFrom(await boundedJson2(fetchFn, `https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version2)}`, {}, 4 * 1024 * 1024), { name, version: version2, integrity });
    }
    facts.set(version2, {
      published_at: published,
      present: true,
      deprecated: typeof manifest.deprecated === "string" && manifest.deprecated ? manifest.deprecated : null,
      publisher: typeof manifest._npmUser?.name === "string" ? manifest._npmUser.name : null,
      shared_publisher: sharedPublisher(manifest._npmUser),
      provenance,
      install_scripts: installScripts(manifest.scripts),
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort(),
      integrity,
      package_created: created
    });
  }
  return facts;
}
async function osvIds(packages, fetchFn = fetch) {
  const result = /* @__PURE__ */ new Map();
  for (let start = 0; start < packages.length; start += 100) {
    const slice = packages.slice(start, start + 100);
    const body = await boundedJson2(fetchFn, "https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: slice.map((p) => ({ package: { ecosystem: "npm", name: p.name }, version: p.version })) }) }, 8 * 1024 * 1024);
    if (!Array.isArray(body?.results) || body.results.length !== slice.length) throw new Error("OSV batch result count mismatch.");
    body.results.forEach((item, i) => {
      if (item?.next_page_token) throw new Error("OSV paginated a judge query; refusing a partial answer.");
      const ids = (item?.vulns ?? []).map((v) => v?.id);
      if (!ids.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(id))) throw new Error("Invalid OSV advisory id.");
      result.set(`${slice[i].name}@${slice[i].version}`, ids);
    });
  }
  return result;
}
async function kevCves(fetchFn = fetch) {
  const body = await boundedJson2(fetchFn, "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {}, 32 * 1024 * 1024);
  if (!Array.isArray(body?.vulnerabilities)) throw new Error("Invalid KEV catalog.");
  return new Set(body.vulnerabilities.map((v) => v?.cveID).filter((id) => typeof id === "string"));
}
async function epssScores(cves, fetchFn = fetch) {
  const scores = /* @__PURE__ */ new Map();
  for (let at = 0; at < cves.length; at += 50) {
    const slice = cves.slice(at, at + 50).filter((c) => /^CVE-\d{4}-\d{4,}$/.test(c));
    if (!slice.length) continue;
    const body = await boundedJson2(fetchFn, `https://api.first.org/data/v1/epss?cve=${slice.join(",")}`, {}, 4 * 1024 * 1024);
    for (const row of body?.data ?? []) if (typeof row?.cve === "string" && Number.isFinite(Number(row.epss))) scores.set(row.cve, Number(row.epss));
  }
  return scores;
}
async function gatherFacts(changes, fetchFn = fetch, also = []) {
  const wanted = /* @__PURE__ */ new Map();
  const want = (name, version2) => {
    const set = wanted.get(name) ?? /* @__PURE__ */ new Set();
    set.add(version2);
    wanted.set(name, set);
  };
  for (const c of changes) {
    want(c.name, c.to);
    if (c.from) want(c.name, c.from);
  }
  for (const e of also) want(e.name, e.version);
  const all = [...wanted].flatMap(([name, versions]) => [...versions].map((version2) => ({ name, version: version2 })));
  const ids = await osvIds(all, fetchFn);
  const facts = /* @__PURE__ */ new Map();
  for (const [name, versions] of wanted) {
    const registry = await registryFacts(name, [...versions], fetchFn);
    for (const [version2, fact] of registry) {
      const all2 = ids.get(`${name}@${version2}`) ?? [];
      facts.set(`${name}@${version2}`, { ...fact, malicious: all2.filter((id) => id.startsWith("MAL-")), advisories: all2.filter((id) => !id.startsWith("MAL-")) });
    }
  }
  const created = /* @__PURE__ */ new Map();
  for (const [id, f] of facts) created.set(id.slice(0, id.lastIndexOf("@")), f.package_created ?? null);
  for (const c of changes) {
    const next = facts.get(`${c.name}@${c.to}`), prev = c.from ? facts.get(`${c.name}@${c.from}`) : void 0;
    for (const name of next && prev?.present ? next.dependencies.filter((d) => !prev.dependencies.includes(d)) : []) if (!created.has(name)) created.set(name, (await npmReleases(name, fetchFn)).created);
  }
  const fixed = [];
  for (const c of changes) {
    if (!c.from) continue;
    const after = new Set(ids.get(`${c.name}@${c.to}`) ?? []);
    for (const id of ids.get(`${c.name}@${c.from}`) ?? []) if (!id.startsWith("MAL-") && !after.has(id)) fixed.push({ id, package: c.name, from: c.from, to: c.to });
  }
  const records = /* @__PURE__ */ new Map();
  for (const id of new Set(fixed.map((f) => f.id))) {
    const record = await boundedJson2(fetchFn, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {}, 4 * 1024 * 1024);
    records.set(id, {
      aliases: Array.isArray(record?.aliases) ? record.aliases.filter((a) => typeof a === "string") : [],
      severity: typeof record?.database_specific?.severity === "string" ? record.database_specific.severity : null
    });
  }
  const cves = [...new Set([...records.values()].flatMap((r) => r.aliases).filter((a) => a.startsWith("CVE-")))];
  const kev = fixed.length ? await kevCves(fetchFn) : /* @__PURE__ */ new Set();
  const epss = cves.length ? await epssScores(cves, fetchFn) : /* @__PURE__ */ new Map();
  const fixes = fixed.map((f) => {
    const r = records.get(f.id);
    const cveScores = r.aliases.map((a) => epss.get(a)).filter((s) => s !== void 0);
    return { id: f.id, package: f.package, from: f.from, to: f.to, aliases: r.aliases, severity: r.severity, kev: r.aliases.some((a) => kev.has(a)), epss: cveScores.length ? Math.max(...cveScores) : null };
  });
  return { facts, fixes, created };
}

// src/security/dependency-patch.ts
var NPM_FINAL_MANIFEST = "ludion-final-package.json";
function changedPackages(before, after) {
  const versions = (inventory2) => {
    const map = /* @__PURE__ */ new Map();
    for (const p of inventory2.packages) map.set(p.name, [...map.get(p.name) ?? [], p.version].sort());
    return map;
  };
  const a = versions(before), b = versions(after);
  return [.../* @__PURE__ */ new Set([...a.keys(), ...b.keys()])].sort().map((name) => ({ name, from: a.get(name) ?? [], to: b.get(name) ?? [] })).filter((c) => c.from.join("\0") !== c.to.join("\0"));
}
function unplannedRemovals(before, after, plan) {
  const kept = new Set(after.packages.map((p) => `${p.name}\0${p.version}`));
  const planned = new Set(plan.map((c) => `${c.name}\0${c.from}`));
  return before.packages.filter((p) => !kept.has(`${p.name}\0${p.version}`) && !planned.has(`${p.name}\0${p.version}`)).map((p) => `${p.name}@${p.version}`);
}
async function candidateTimeCap(ecosystem, before, after, plan, fetchFn = fetch) {
  const locked = new Set(before.packages.map((p) => `${p.name}@${p.version}`)), lockedNames = new Set(before.packages.map((p) => p.name));
  const added = after.packages.filter((p) => !locked.has(`${p.name}@${p.version}`));
  const planned = new Set(plan.map((c) => c.name));
  const releases = /* @__PURE__ */ new Map();
  const read = async (name) => {
    if (!releases.has(name)) releases.set(name, await (ecosystem === "npm" ? npmReleases : packagistReleases)(name, fetchFn));
    return releases.get(name);
  };
  for (const name of new Set(added.map((p) => p.name))) await read(name);
  const newDependencies = added.filter((p) => !lockedNames.has(p.name)).map((p) => p.name);
  for (const p of added.filter((p2) => planned.has(p2.name))) {
    const r = await read(p.name), from = before.packages.filter((b) => b.name === p.name).map((b) => r.requires.get(composerVersion(b.version)));
    const now = r.requires.get(composerVersion(p.version)) ?? [];
    newDependencies.push(...now.filter((d) => !from.some((f) => f?.includes(d))));
  }
  for (const name of new Set(newDependencies)) await read(name);
  const plannedTo = new Set(plan.map((c) => `${c.name}@${composerVersion(c.to)}`));
  const input = {
    targets: added.filter((p) => plannedTo.has(`${p.name}@${composerVersion(p.version)}`)),
    others: added,
    locked,
    newDependencies,
    published: (name, version2) => releases.get(name)?.published.get(composerVersion(version2)),
    created: (name) => releases.get(name)?.created,
    waitHours: WAIT_HOURS.low
  };
  const cap = timeCap(input);
  if (ecosystem !== "npm" || !cap.after_t.length) return cap;
  const identities = /* @__PURE__ */ new Map();
  const wanted = [...input.targets.map((p) => `${p.name}@${p.version}`), ...cap.after_t];
  try {
    for (const name of new Set(wanted.map((id) => id.slice(0, id.lastIndexOf("@"))))) {
      const versions = wanted.filter((id) => id.slice(0, id.lastIndexOf("@")) === name).map((id) => id.slice(id.lastIndexOf("@") + 1));
      for (const [version2, f] of await registryFacts(name, versions, fetchFn)) identities.set(`${name}@${version2}`, releaseIdentity({ ...f, malicious: [], advisories: [] }));
    }
  } catch (error) {
    return { ...cap, undecidable: [...cap.undecidable, `The publisher and provenance for the same-release check could not be read: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`] };
  }
  return timeCap({ ...input, identity: (name, version2) => identities.get(`${name}@${version2}`) });
}
function compatible(before, after) {
  for (const pkg of before.packages) {
    const next = after.packages.filter((p) => p.name === pkg.name);
    const old = comparableVersion(pkg.version, pkg.ecosystem);
    const allowed = (p) => {
      const current = comparableVersion(p.version, p.ecosystem);
      return !!old && !!current && import_semver5.default.major(current) === import_semver5.default.major(old) && (import_semver5.default.major(old) !== 0 || import_semver5.default.minor(current) === import_semver5.default.minor(old));
    };
    if (pkg.direct && !next.some((p) => p.direct && allowed(p))) throw new Error(`Candidate removed or changed the major version of a direct dependency: ${pkg.name}.`);
    if (next.some((p) => p.version === pkg.version)) continue;
    const novel = next.filter((p) => !before.packages.some((b) => b.name === p.name && b.version === p.version));
    if (novel.length && !novel.some(allowed)) {
      throw new Error(`Automatic update would change an existing package's major version: ${pkg.name}.`);
    }
    if (pkg.direct && !next.length) throw new Error(`Candidate removed a direct dependency: ${pkg.name}.`);
  }
}
function acquisitionPolicy(root, ecosystem) {
  if (ecosystem === "npm") {
    const p = jsonFile(root, "package.json"), lock = jsonFile(root, "package-lock.json");
    if (p.workspaces) throw new Error("Register npm workspaces individually after producing a standalone package-lock; workspace patching is not supported yet.");
    for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, spec] of Object.entries(p[group] ?? {})) if (typeof spec !== "string" || !import_semver5.default.validRange(spec)) throw new Error(`Non-registry or unresolved npm requirement needs review: ${name}.`);
    }
    const overrides = (item) => {
      if (typeof item === "string") {
        if (!import_semver5.default.validRange(item)) throw new Error("Non-registry npm overrides need manual review.");
      } else if (item && typeof item === "object" && !Array.isArray(item)) for (const value2 of Object.values(item)) overrides(value2);
      else throw new Error("Invalid npm overrides.");
    };
    if (p.overrides) overrides(p.overrides);
    for (const item of Object.values(lock.packages ?? {})) {
      if (item.link) throw new Error("Linked npm packages need manual review.");
      if (item.resolved !== void 0) {
        const url = new URL(item.resolved);
        if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password) throw new Error("Automatic npm acquisition accepts only public registry.npmjs.org tarballs.");
      }
    }
  } else if (ecosystem === "composer") {
    const p = jsonFile(root, "composer.json");
    if (p.repositories) throw new Error("Custom Composer repositories need a separate trusted acquisition policy.");
    if (p.config?.["vendor-dir"] && p.config["vendor-dir"] !== "vendor") throw new Error("Custom Composer vendor directories are not supported yet.");
    for (const key of ["http-basic", "bearer", "github-oauth", "gitlab-oauth", "gitlab-token"]) if (p.config?.[key]) throw new Error("Credentials must not be embedded in the acquisition manifest.");
    if (p.config?.["secure-http"] === false || p.config?.["disable-tls"]) throw new Error("Insecure Composer transport is refused.");
    if (p.config?.["source-fallback"] || p.config?.policy !== void 0 || p.config?.audit !== void 0) throw new Error("Composer policy overrides/source fallback need manual review.");
    const lock = jsonFile(root, "composer.lock");
    for (const item of [...lock.packages ?? [], ...lock["packages-dev"] ?? []]) {
      if (item.dist?.url && item.dist.type === "zip") publicArchiveUrl(item.dist.url);
      else throw new Error("Composer acquisition requires a distribution archive for every locked package.");
    }
  } else {
    const p = parsePom(textFile(root, "pom.xml"));
    if (p.limitations.length) throw new Error(p.limitations.join(" "));
    const elements = Array.from(p.document.getElementsByTagName("*"));
    if (elements.some((e) => ["extensions", "repositories", "pluginRepositories", "profiles", "modules", "parent"].includes(e.localName ?? ""))) throw new Error("Maven parents, profiles, extensions, modules and custom repositories need manual review.");
    if (elements.some((e) => e.namespaceURI !== p.project.namespaceURI)) throw new Error("Mixed-namespace Maven models need review.");
    const packaging = elements.find((e) => e.parentNode === p.project && e.localName === "packaging")?.textContent?.trim();
    if (packaging && packaging !== "jar" && packaging !== "pom") throw new Error("Custom Maven packaging needs review.");
  }
}
function resolverDockerfile(ecosystem, image, candidate, inventoryOnly = false, plan = []) {
  const run = (args) => `RUN ${JSON.stringify(args)}
`;
  if (candidate && ecosystem !== "maven") {
    if (!plan.length) throw new Error("A candidate needs at least one planned fix.");
    for (const change of plan) {
      packageEntry(ecosystem, change.name, change.to, false);
      if (!/^\d/.test(change.to)) throw new Error("Planned fixed versions must start with a digit.");
    }
  }
  const npmFlags = ["--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"];
  let text = `FROM ${image} AS resolve
USER root
RUN mkdir -p /app /opt/ludion-m2 && chown -R 65534:65534 /app /opt/ludion-m2
WORKDIR /app
ENV HOME=/tmp COMPOSER_HOME=/tmp/composer MAVEN_CONFIG=/tmp/maven NPM_CONFIG_CACHE=/tmp/npm
`;
  if (ecosystem === "npm") {
    text += run(["npm", "install", "--global", "npm@12.2.1", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"]);
    text += run(["chown", "-R", "65534:65534", "/tmp/npm"]);
  }
  text += "COPY --chown=65534:65534 manifests/ ./\nUSER 65534:65534\n";
  if (ecosystem === "npm") {
    text += run(["node", "-e", "if(require('/usr/local/lib/node_modules/npm/package.json').version!=='12.2.1')process.exit(1)"]);
    if (candidate) {
      text += run(["npm", "install", "--package-lock-only", ...npmFlags]);
      text += run(["cp", NPM_FINAL_MANIFEST, "package.json"]);
      text += run(["npm", "install", "--package-lock-only", ...npmFlags]);
      text += run(["rm", NPM_FINAL_MANIFEST]);
    }
    text += run(["npm", "ci", ...npmFlags]);
  } else if (ecosystem === "composer" && candidate) text += run(["composer", "update", "--with-dependencies", "--minimal-changes", "--no-install", "--no-plugins", "--no-scripts", "--no-interaction", "--prefer-dist", "--no-progress", "--", ...plan.map((c) => `${c.name}:${c.to}`)]);
  else {
    const goal = "org.apache.maven.plugins:maven-dependency-plugin:3.11.0:";
    if (ecosystem === "maven") {
      text += run(["mvn", "--batch-mode", "--settings", "/app/ludion-settings.xml", "-Dmaven.repo.local=/opt/ludion-m2", ...inventoryOnly ? [] : [`${goal}go-offline`, `${goal}copy-dependencies`, "-DoutputDirectory=/app/lib"], `${goal}tree`, "-DoutputType=json", "-DoutputFile=/app/ludion-dependency-tree.json", "-Dmdep.skip=false"]);
      text += run(["cp", "/app/ludion-original-pom.xml", "/app/pom.xml"]);
    }
  }
  return text;
}
function prepareMavenManifest(directory, original) {
  writeFileSync4(join5(directory, "ludion-original-pom.xml"), original);
  writeFileSync4(join5(directory, "pom.xml"), acquisitionPom(original));
  writeFileSync4(join5(directory, "ludion-settings.xml"), MAVEN_SETTINGS);
}
async function resolvedMavenInventory(root, image = DEFAULT_IMAGES.maven, deps = {}) {
  const active = () => {
    if (deps.signal?.aborted) throw new Error("Maven inventory cancelled.");
  };
  active();
  acquisitionPolicy(root, "maven");
  const declared = inventory(root, "maven"), original = textFile(root, "pom.xml");
  if (!/^maven:[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@sha256:[a-f0-9]{64})?$/.test(image)) throw new Error("Use an official Maven tool image.");
  const command = deps.command ?? runDockerImageCommand;
  const temp = mkdtempSync2(join5(tmpdir2(), "ludion-maven-inventory-")), name = `ludion-inventory-${randomUUID2()}`;
  try {
    const manifests = join5(temp, "manifests"), output = join5(temp, "output");
    mkdirSync3(manifests);
    mkdirSync3(output);
    prepareMavenManifest(manifests, original);
    await command(["pull", image], 3e5);
    active();
    const digests = JSON.parse(await command(["image", "inspect", image, "--format", "{{json .RepoDigests}}"], 15e3));
    active();
    const digest = Array.isArray(digests) && digests.find((d) => typeof d === "string" && /^(?:(?:docker\.io\/)?library\/)?maven@sha256:[a-f0-9]{64}$/.test(d));
    if (!digest) throw new Error("Missing official Maven image digest.");
    writeFileSync4(join5(temp, "Dockerfile"), resolverDockerfile("maven", `${image.split("@")[0]}@${String(digest).split("@")[1]}`, false, true));
    await command(["build", "--network=default", "--pull=false", "--tag", name, temp], 6e5);
    active();
    writeFileSync4(join5(temp, "export.Dockerfile"), `FROM ${name} AS graph
FROM scratch
COPY --from=graph /app/ludion-dependency-tree.json /ludion-dependency-tree.json
`);
    await command(["build", "--network=none", "--pull=false", "--file", join5(temp, "export.Dockerfile"), "--output", `type=local,dest=${output}`, temp], 12e4);
    active();
    if (textFile(root, "pom.xml") !== original) throw new Error("Maven manifest changed during resolution.");
    return { ...declared, scope: "resolved_dependencies_not_plugins_or_jdk", packages: mavenGraph(jsonFile(output, "ludion-dependency-tree.json"), new Set(declared.packages.map((p) => p.name))) };
  } finally {
    await command(["image", "rm", name], 15e3).catch(() => {
    });
    if (resolve3(temp).startsWith(resolve3(tmpdir2()) + sep2)) rmSync2(temp, { recursive: true, force: true });
  }
}
function applyFiles(root, state, id, files, rename = renameSync2) {
  const dir = join5(state, `transaction-${id}`);
  mkdirSync3(dir, { mode: 448 });
  const journal = join5(dir, "journal.json");
  const entries = files.map((f) => ({ path: f.path, before_hash: hash(f.before), after_hash: hash(f.after), mode: lstatSync4(regularFile(root, f.path)).mode & 511 }));
  const completed = [];
  for (const f of files) {
    const target = regularFile(root, f.path);
    if (readFileSync5(target, "utf8") !== f.before) throw new Error("Dependency files changed before application.");
    writeFileSync4(join5(dir, `${f.path}.before`), f.before, { flag: "wx", mode: 384 });
    writeFileSync4(join5(dir, `${f.path}.next`), f.after, { flag: "wx", mode: lstatSync4(target).mode & 511 });
    chmodSync2(join5(dir, `${f.path}.next`), lstatSync4(target).mode & 511);
  }
  const record = (phase) => writeFileSync4(journal, `${JSON.stringify({ schema: 1, phase, files: entries, applied: completed.map((f) => f.path) }, null, 2)}
`, { mode: 384 });
  record("prepared");
  try {
    for (const file of files) {
      rename(join5(dir, `${file.path}.next`), regularFile(root, file.path));
      completed.push(file);
      record("applying");
    }
    record("complete");
  } catch (error) {
    let failed = false;
    for (const f of [...completed].reverse()) {
      try {
        if (hash(readFileSync5(regularFile(root, f.path))) !== hash(f.after)) throw new Error("Concurrent change prevents rollback.");
        rename(join5(dir, `${f.path}.before`), join5(root, f.path));
        chmodSync2(join5(root, f.path), entries.find((e) => e.path === f.path).mode);
      } catch {
        failed = true;
      }
    }
    record(failed ? "manual_recovery_required" : "rolled_back");
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${failed ? "Partial update: manual recovery required." : "Our source changes were rolled back."} Journal: ${journal}`);
  }
  return journal;
}
async function patchDependencies(dir, apply, deps = {}) {
  const active = () => {
    if (deps.signal?.aborted) throw new Error("Update cancelled; pending source changes were not applied.");
  };
  active();
  const root = rootPath(dir), config = readConfig(root);
  if ("dockerfile" in config) throw new Error("A dependency ecosystem configuration is required.");
  const configText = textFile(root, CONFIG), originalTree = snapshot(root);
  if (JSON.stringify(readConfig(root)) !== JSON.stringify(config)) throw new Error("Update policy changed before scanning.");
  const ecosystem = config.ecosystem, client = deps.client ?? new OsvClient();
  const initial = ecosystem === "maven" ? await resolvedMavenInventory(root, config.image, deps) : inventory(root, ecosystem), scan = await client.scan(initial);
  active();
  if (snapshot(root) !== originalTree || textFile(root, CONFIG) !== configText) throw new Error("Project changed during advisory lookup; rerun the update.");
  if (!scan.findings.length) return { scan, receipt: null, path: null };
  const state = privateState(root), lock = join5(state, "patch.lock"), id = randomUUID2();
  let fd;
  try {
    fd = openSync3(lock, "wx", 384);
  } catch {
    throw new Error("Another update or interrupted transaction holds patch.lock. Inspect its receipt/journal before retrying.");
  }
  const receiptPath = join5(state, `${id}.json`), images = [];
  const receipt = { schema: 1, id, ecosystem, scope: "dependency_files_only_not_deployed", started_at: (/* @__PURE__ */ new Date()).toISOString(), finished_at: "", outcome: "failed", tree_hash: originalTree, config_hash: hash(configText), before: scan, after: null, tool_image: "", baseline_image: null, candidate_image: null, baseline_passed: false, candidate_passed: false, test: [...config.test], files: [] };
  let temp = "";
  const command = deps.command ?? runDockerImageCommand;
  const run = deps.testRun ?? (async (name, image, command2, timeoutMs, tool) => {
    const result = await runContainer(name, image, command2, timeoutMs, tool);
    if (result.kind === "spawn_error") throw new Error(`Docker unavailable: ${result.message}`);
    if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "Application validation timed out." : `Application validation failed (${result.exitCode}): ${result.stderr.slice(-1e3)}`);
  });
  try {
    writeFileSync4(fd, JSON.stringify({ id, pid: process.pid, started_at: receipt.started_at }));
    temp = mkdtempSync2(join5(tmpdir2(), "ludion-dependencies-"));
    const source = join5(temp, "source");
    mkdirSync3(source);
    if (snapshot(root, source) !== originalTree || hash(textFile(source, CONFIG)) !== receipt.config_hash) throw new Error("Source or update policy changed during advisory lookup.");
    if (initial.limitations.length) throw new Error(initial.limitations.join(" "));
    if (scan.blocked.length) throw new Error(scan.blocked.join(" "));
    acquisitionPolicy(source, ecosystem);
    const requested = config.image ?? DEFAULT_IMAGES[ecosystem];
    const repo = { npm: "node", composer: "composer", maven: "maven" }[ecosystem];
    if (!new RegExp(`^${repo}:[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@sha256:[a-f0-9]{64})?$`).test(requested)) throw new Error(`Use an official ${repo} tool image; custom registries/images are not accepted by this adapter.`);
    await command(["pull", requested], 3e5);
    active();
    const digests = JSON.parse(await command(["image", "inspect", requested, "--format", "{{json .RepoDigests}}"], 15e3));
    active();
    const resolved = Array.isArray(digests) && digests.find((d) => typeof d === "string" && new RegExp(`^(?:(?:docker\\.io/)?library/)?${repo}@sha256:[a-f0-9]{64}$`).test(d));
    if (!resolved) throw new Error("Official tool image digest is unavailable.");
    receipt.tool_image = `${requested.split("@")[0]}@${String(resolved).split("@")[1]}`;
    let baselineInventory = initial;
    let candidateFiles = [];
    let finalManifest = "";
    for (const label of ["baseline", "candidate"]) {
      active();
      const context = join5(temp, label), manifests = join5(context, "manifests"), exported = join5(temp, `${label}-export`), app = join5(temp, `${label}-app`);
      mkdirSync3(manifests, { recursive: true });
      mkdirSync3(exported);
      mkdirSync3(app);
      for (const file of MANIFESTS[ecosystem]) writeFileSync4(join5(manifests, file), textFile(source, file));
      if (label === "candidate") {
        finalManifest = changedManifest(source, ecosystem, scan.plan);
        writeFileSync4(join5(manifests, MANIFESTS[ecosystem][0]), ecosystem === "npm" ? changedManifest(source, ecosystem, scan.plan, true) : finalManifest);
        if (ecosystem === "npm") writeFileSync4(join5(manifests, NPM_FINAL_MANIFEST), finalManifest);
      }
      if (ecosystem === "maven") prepareMavenManifest(manifests, readFileSync5(join5(manifests, "pom.xml"), "utf8"));
      writeFileSync4(join5(context, "Dockerfile"), resolverDockerfile(ecosystem, receipt.tool_image, label === "candidate", false, scan.plan));
      const cache = `ludion-cache-${id}-${label}`;
      images.push(cache);
      await command(["build", "--network=default", "--pull=false", "--target", "resolve", "--tag", cache, context], 6e5);
      active();
      const exportFile = join5(context, "export.Dockerfile");
      const exportedFiles = [...MANIFESTS[ecosystem], ...ecosystem === "maven" ? ["ludion-dependency-tree.json"] : []];
      writeFileSync4(exportFile, `FROM ${cache} AS captured
FROM scratch
${exportedFiles.map((f) => `COPY --from=captured /app/${f} /${f}`).join("\n")}
`);
      await command(["build", "--network=none", "--pull=false", "--file", exportFile, "--output", `type=local,dest=${exported}`, context], 12e4);
      active();
      acquisitionPolicy(exported, ecosystem);
      let installedCache = cache;
      if (ecosystem === "composer") {
        const install = join5(temp, `${label}-install`), archives = join5(install, "archives");
        mkdirSync3(install);
        receipt.archives = [...receipt.archives ?? [], ...await localComposerLock(exported, archives, join5(temp, "archives-cache"), deps.fetchFn, deps.signal)];
        active();
        writeFileSync4(join5(install, "composer.json"), textFile(exported, "composer.json"));
        cpSync(join5(archives, "composer.lock"), join5(install, "composer.lock"));
        writeFileSync4(join5(install, "Dockerfile"), `FROM ${cache}
USER root
RUN mkdir -p /archives && chown 65534:65534 /archives
WORKDIR /app
COPY --chown=65534:65534 archives/ /archives/
COPY --chown=65534:65534 composer.json composer.lock /app/
ENV COMPOSER_DISABLE_NETWORK=1
USER 65534:65534
RUN ["composer","install","--no-plugins","--no-scripts","--no-interaction","--prefer-dist","--no-progress"]
`);
        installedCache = `ludion-installed-${id}-${label}`;
        images.push(installedCache);
        await command(["build", "--network=none", "--pull=false", "--tag", installedCache, install], 3e5);
        active();
      }
      const resolvedInventory = inventory(exported, ecosystem);
      if (ecosystem === "maven") {
        const direct = new Set(resolvedInventory.packages.map((p) => p.name));
        resolvedInventory.packages = mavenGraph(jsonFile(exported, "ludion-dependency-tree.json"), direct);
        resolvedInventory.scope = "resolved_dependencies_not_plugins_or_jdk";
      }
      if (label === "baseline") {
        for (const file of MANIFESTS[ecosystem]) if (textFile(exported, file) !== textFile(source, file)) throw new Error("Baseline acquisition changed a dependency file.");
        baselineInventory = resolvedInventory;
      } else {
        if (ecosystem !== "maven" && textFile(exported, MANIFESTS[ecosystem][0]) !== finalManifest) throw new Error("The package manager changed the manifest beyond the planned fix.");
        receipt.changed_packages = changedPackages(baselineInventory, resolvedInventory);
        if (ecosystem !== "maven") {
          const moved = unplannedRemovals(baselineInventory, resolvedInventory, scan.plan);
          if (moved.length) throw new Error(`The candidate also moved packages that were not planned (${moved.slice(0, 10).join(", ")}${moved.length > 10 ? ", ..." : ""}); that needs review.`);
        }
        if (ecosystem !== "maven") {
          const cap = receipt.time_cap = await candidateTimeCap(ecosystem, baselineInventory, resolvedInventory, scan.plan, deps.fetchFn);
          active();
          if (cap.undecidable.length) throw new Error(`The time cap could not be checked: ${cap.undecidable.slice(0, 5).join(" ")}`);
          if (cap.after_t.length || cap.young.length) throw new Error(`The candidate breaks the time cap. ${renderTimeCap(cap).join(" ")}${cap.young.length ? ` New dependencies first published less than ${cap.wait_hours}h before T: ${cap.young.join(", ")}.` : ""}`);
        }
        compatible(baselineInventory, resolvedInventory);
        receipt.after = await client.scan(resolvedInventory);
        active();
        if (receipt.after.findings.length || receipt.after.inventory.limitations.length) throw new Error("Candidate still contains known advisory findings or incomplete inventory; no source changes applied.");
        candidateFiles = MANIFESTS[ecosystem].map((path) => ({ path, before: textFile(source, path), after: textFile(exported, path) })).filter((f) => f.before !== f.after);
        if (!candidateFiles.length) throw new Error("No dependency file changed.");
      }
      cpSync(source, app, { recursive: true });
      writeFileSync4(join5(app, ".dockerignore"), "node_modules\nvendor\ntarget\n.ludion\n.git\n.env\n.env.*\n.npmrc\nauth.json\n.mvn\n");
      for (const file of MANIFESTS[ecosystem]) writeFileSync4(join5(app, file), textFile(exported, file));
      writeFileSync4(join5(app, "Dockerfile.ludion"), `FROM ${installedCache}
WORKDIR /app
COPY --chown=65534:65534 . /app
USER 65534:65534
`);
      const image = `ludion-application-${id}-${label}`;
      images.push(image);
      await command(["build", "--network=none", "--pull=false", "--file", join5(app, "Dockerfile.ludion"), "--tag", image, app], 3e5);
      active();
      const imageId = await command(["image", "inspect", image, "--format", "{{.Id}}"], 15e3);
      active();
      if (label === "baseline") receipt.baseline_image = imageId;
      else receipt.candidate_image = imageId;
      const name = `ludion-check-${id}-${label}`;
      await run(name, imageId, config.test, config.timeout_seconds * 1e3, ecosystem);
      active();
      if (label === "baseline") receipt.baseline_passed = true;
      else receipt.candidate_passed = true;
    }
    if (snapshot(root) !== receipt.tree_hash) throw new Error("Project changed during validation; no dependency file was updated.");
    active();
    receipt.files = candidateFiles.map((f) => ({ path: f.path, before_hash: hash(f.before), after_hash: hash(f.after) }));
    receipt.outcome = "validated";
    writeFileSync4(receiptPath, `${JSON.stringify(receipt, null, 2)}
`, { flag: "wx", mode: 384 });
    if (apply) {
      active();
      receipt.recovery_journal = join5(state, `transaction-${id}`, "journal.json");
      applyFiles(root, state, id, candidateFiles);
      receipt.outcome = "applied";
    }
  } catch (error) {
    receipt.outcome = "failed";
    receipt.reason = error instanceof Error ? error.message : String(error);
  } finally {
    receipt.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    try {
      writeFileSync4(receiptPath, `${JSON.stringify(receipt, null, 2)}
`, { mode: 384 });
    } finally {
      for (const image of images.reverse()) await command(["image", "rm", image], 15e3).catch(() => {
      });
      if (temp && resolve3(temp).startsWith(resolve3(tmpdir2()) + sep2)) rmSync2(temp, { recursive: true, force: true });
      closeSync3(fd);
      rmSync2(lock);
    }
  }
  return { scan, receipt, path: receiptPath };
}

// src/security/scan.ts
import { existsSync as existsSync6 } from "node:fs";
import { join as join6 } from "node:path";
async function scanProject(root, selected) {
  const checks = [];
  const saved = existsSync6(join6(root, CONFIG)) ? readConfig(root) : void 0;
  const phpFile = saved && "dockerfile" in saved ? saved.dockerfile : "Dockerfile";
  const detected = detectEcosystems(root), ecosystems = selected && selected !== "auto" ? selected === "php" ? [] : [selected] : detected;
  const client = new OsvClient();
  for (const ecosystem of ecosystems) {
    if (!["npm", "composer", "maven"].includes(ecosystem)) throw new Error("Supported ecosystems: php, npm, composer, maven, auto.");
    try {
      let installed = inventory(root, ecosystem);
      const originals = installed.files.map((f) => [f, textFile(root, f)]);
      if (ecosystem === "maven") {
        const config = existsSync6(join6(root, CONFIG)) ? readConfig(root) : void 0;
        const image = config && "ecosystem" in config && config.ecosystem === "maven" ? config.image : void 0;
        installed = await resolvedMavenInventory(root, image);
      }
      const result = await client.scan(installed);
      if (originals.some(([file, original]) => textFile(root, file) !== original)) throw new Error("Dependency files changed during the scan.");
      checks.push({ ecosystem, result });
    } catch (error) {
      checks.push({ ecosystem, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (selected === "php" || (!selected || selected === "auto") && existsSync6(join6(root, phpFile)) && /\bphp:/.test(textFile(root, phpFile))) {
    try {
      checks.push({ ecosystem: "php", result: await scanPhp(textFile(root, phpFile)) });
    } catch (error) {
      checks.push({ ecosystem: "php", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const unsupported = selected && selected !== "auto" ? [] : ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.lock", "build.gradle", "build.gradle.kts"].filter((f) => existsSync6(join6(root, f)));
  if (!checks.length && !unsupported.length) throw new Error("No supported project inventory found. Expected PHP Dockerfile, npm lockfile, composer.lock or pom.xml.");
  const attention = unsupported.length > 0 || checks.some((c) => "error" in c || ("findings" in c.result ? c.result.findings.length > 0 || c.result.status === "incomplete" : c.result.candidate !== null));
  return { schema: 1, checked_at: (/* @__PURE__ */ new Date()).toISOString(), status: attention ? "attention_required" : "no_known_updates", checks, unsupported };
}

// src/security/cli.ts
async function securityCli(command, args) {
  const { values } = parseArgs({ args, options: { dir: { type: "string", default: "." }, ecosystem: { type: "string" }, json: { type: "boolean" }, apply: { type: "boolean" }, interval: { type: "string", default: "900" } } });
  if (values.apply && !["patch", "watch"].includes(command)) throw new Error("--apply is only valid with patch or watch.");
  if (values.ecosystem && !["init", "scan"].includes(command)) throw new Error("--ecosystem selects init/scan only; patch/watch use the saved project policy.");
  if (values.ecosystem && !["auto", "php", "npm", "composer", "maven"].includes(values.ecosystem)) throw new Error("Supported ecosystems: php, npm, composer, maven, auto.");
  const root = rootPath(values.dir);
  if (command === "init") {
    if (existsSync7(join7(root, CONFIG))) throw new Error(`${CONFIG} already exists. Edit it to choose your real validation command.`);
    const choices = detectEcosystems(root);
    if (existsSync7(join7(root, "Dockerfile")) && /\bphp:/.test(textFile(root, "Dockerfile"))) choices.push("php");
    const selected = values.ecosystem && values.ecosystem !== "auto" ? values.ecosystem : choices.length === 1 ? choices[0] : void 0;
    if (!selected) throw new Error("Choose the update policy with --ecosystem php|npm|composer|maven. A multi-ecosystem project can be scanned together; each patch policy chooses its dependency manager.");
    let config = DEFAULT_CONFIG;
    if (selected === "php") regularFile(root, "Dockerfile");
    else {
      const ecosystem = selected;
      config = { schema: 1, ecosystem, image: DEFAULT_IMAGES[ecosystem], test: ecosystem === "npm" ? ["npm", "test"] : ecosystem === "composer" ? ["php", "tests/smoke.php"] : ["mvn", "--offline", "--batch-mode", "-Dmaven.repo.local=/opt/ludion-m2", "-DfailIfNoTests=true", "verify"], timeout_seconds: 120 };
    }
    writeFileSync5(join7(root, CONFIG), `${JSON.stringify(config, null, 2)}
`, { flag: "wx" });
    console.log(`Created ${CONFIG} (${selected}). Choose the tool image matching your application and its real offline test command before patching. No update was applied.`);
    return 0;
  }
  if (command === "scan") {
    const report = await scanProject(root, values.ecosystem);
    const only = report.checks.length === 1 ? report.checks[0] : void 0;
    if (values.json) console.log(JSON.stringify(only && only.ecosystem === "php" && "result" in only && !report.unsupported.length ? only.result : report, null, 2));
    else {
      for (const check of report.checks) {
        if ("error" in check) {
          console.error(`${check.ecosystem}: unavailable \u2014 ${check.error}`);
          continue;
        }
        if ("findings" in check.result) {
          console.log(`${check.ecosystem}: ${check.result.inventory.packages.length} package versions \xB7 ${check.result.findings.length} advisory matches \xB7 ${check.result.status}`);
          for (const finding of check.result.findings) console.log(`  ${finding.package.name}@${finding.package.version} \xB7 ${finding.advisory.id} \xB7 ${finding.advisory.summary}`);
          for (const limit of check.result.inventory.limitations) console.log(`  Incomplete: ${limit}`);
          console.log(`  Scope: ${check.result.inventory.scope}`);
        } else console.log(`php: ${check.result.current.version} \xB7 ${check.result.candidate ? `update ${check.result.candidate.version}` : "no newer security release found"}`);
      }
      if (report.unsupported.length) console.error(`Unsupported inventories: ${report.unsupported.join(", ")}. These have not been checked.`);
      console.log("Known data only; no match is not a security guarantee. Dependency coordinates are sent to OSV; source stays local to your Docker setup.");
    }
    const vulnerable = report.checks.some((c) => "result" in c && ("findings" in c.result ? c.result.findings.length > 0 : c.result.candidate !== null));
    return vulnerable ? 1 : report.status === "attention_required" ? 2 : 0;
  }
  async function patch(signal) {
    const config = readConfig(root);
    const result = "dockerfile" in config ? await patchProject(root, !!values.apply, { signal }) : await patchDependencies(root, !!values.apply, { signal });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (result.receipt) console.log(`Result: ${result.receipt.outcome}${result.receipt.reason ? ` \u2014 ${result.receipt.reason}` : ""}
Receipt: ${result.path}
Source update only. Production deployment was not changed.`);
    else console.log(`Result: ${result.scan.status}. No source update applied. No match is not a security guarantee.`);
    return result.receipt?.outcome === "failed" || result.scan.status === "incomplete" ? 2 : 0;
  }
  if (command === "patch") return patch();
  if (command !== "watch") throw new Error("Unknown security command.");
  const interval = Number(values.interval);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error("--interval must be an integer from 60 to 86400 seconds.");
  const abort = new AbortController(), stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!abort.signal.aborted) {
      try {
        await patch(abort.signal);
      } catch (error) {
        console.error(`ludion: ${error instanceof Error ? error.message : String(error)}`);
      }
      await delay(interval * 1e3, void 0, { signal: abort.signal }).catch((error) => {
        if (!abort.signal.aborted) throw error;
      });
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return 0;
}

// src/security/judge-cli.ts
var import_semver6 = __toESM(require_semver2(), 1);
import { existsSync as existsSync8, lstatSync as lstatSync5, readFileSync as readFileSync6 } from "node:fs";
import { join as join8 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";
async function judgeCli(args) {
  const { values } = parseArgs2({ args, options: { before: { type: "string" }, after: { type: "string" }, files: { type: "string" }, now: { type: "string" }, json: { type: "boolean" } } });
  if (!values.before || !values.after) throw new Error("Give both checkouts: ludion judge --before <dir> --after <dir> --files <changed,files> [--json].");
  const before = rootPath(values.before), after = rootPath(values.after);
  const read = (root, file) => {
    const path = regularFile(root, file);
    if (lstatSync5(path).size > 64 * 1024 * 1024) throw new Error(`${file} exceeds 64 MiB.`);
    return readFileSync6(path, "utf8");
  };
  const files = values.files !== void 0 ? values.files.split(",").map((f) => f.trim()).filter(Boolean) : null;
  const now = values.now ? new Date(values.now) : /* @__PURE__ */ new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO date.");
  if (!existsSync8(join8(after, "package-lock.json")) && existsSync8(join8(after, "pnpm-lock.yaml"))) return pnpm(read(before, "pnpm-lock.yaml"), read(after, "pnpm-lock.yaml"), JSON.parse(read(after, "package.json")), files, now, !!values.json);
  const beforeLock = read(before, "package-lock.json"), afterLock = read(after, "package-lock.json");
  const beforeManifest = read(before, "package.json"), afterManifest = read(after, "package.json");
  const manifest = beforeManifest === afterManifest ? void 0 : { before: JSON.parse(beforeManifest), after: JSON.parse(afterManifest) };
  const beforeEntries = lockEntries(beforeLock), afterEntries = lockEntries(afterLock);
  const changes = allChanges(beforeLock, afterLock), entries = lockEntryChanges(beforeEntries, afterEntries);
  const hadLinks = new Set(lockLinks(beforeLock));
  const links = lockLinks(afterLock).filter((link) => !hadLinks.has(link));
  let facts = /* @__PURE__ */ new Map(), fixes = [], created = /* @__PURE__ */ new Map(), errors = [];
  try {
    ({ facts, fixes, created } = await gatherFacts(changes, fetch, entries.map((e) => ({ name: e.name, version: e.version }))));
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
    facts = /* @__PURE__ */ new Map();
  }
  const locked = new Set(beforeEntries.map((e) => `${e.name}@${e.version}`));
  const result = judge({ changes, entries, facts, fixes, files, links, now, errors, manifest, locked, created, direct: declaredByProject(afterLock) });
  console.log(values.json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return exitCode(result.verdict);
}
var exitCode = (verdict) => verdict === "ready_except_build" ? 0 : verdict === "wait" ? 3 : 1;
function pnpmChanges(beforeText, afterText) {
  const before = fromPnpmLock(beforeText), after = fromPnpmLock(afterText);
  const locked = new Set([...before].flatMap(([name, versions]) => [...versions].map((v) => `${name}@${v}`)));
  const changes = [];
  for (const [name, versions] of after) for (const to of versions) {
    if (locked.has(`${name}@${to}`) || !import_semver6.default.valid(to)) continue;
    const from = [...before.get(name) ?? []].filter((v) => import_semver6.default.valid(v) && import_semver6.default.major(v) === import_semver6.default.major(to)).sort(import_semver6.default.rcompare)[0] ?? null;
    changes.push({ path: "pnpm-lock.yaml", name, from, to, dev: false, resolved: null, integrity: null, replaced: null });
  }
  return { changes: changes.sort((a, b) => a.name.localeCompare(b.name) || import_semver6.default.compare(a.to, b.to)), locked };
}
async function pnpm(beforeLock, afterLock, manifest, files, now, json) {
  const { changes, locked } = pnpmChanges(beforeLock, afterLock);
  let facts = /* @__PURE__ */ new Map(), fixes = [], created = /* @__PURE__ */ new Map(), errors = [];
  try {
    ({ facts, fixes, created } = await gatherFacts(changes, fetch));
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
    facts = /* @__PURE__ */ new Map();
  }
  const direct = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((g) => manifest?.[g] && typeof manifest[g] === "object" ? Object.keys(manifest[g]) : []);
  const result = judge({ changes, facts, fixes, files, now, errors, locked, created, direct, lockfile: "pnpm-lock" });
  console.log(json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return exitCode(result.verdict);
}

// src/cli.ts
var HELP = `ludion: security updates for PHP Docker, npm, Composer and Maven (source preview).

  ludion init [--dir <path>] [--ecosystem php|npm|composer|maven]
      Create ludion.security.json. Set your application's real test command.
  ludion scan [--dir <path>] [--ecosystem php|npm|composer|maven] [--json]
      Detect supported inventories and look up PHP releases / OSV advisories.
      Exit 1: attention needed; 2: error. An empty result is not a security guarantee.
  ludion patch [--dir <path>] [--apply] [--json]
      Download official images, build and test old/new versions offline, and save a receipt.
      --apply updates only source dependency files after validation. Production is not deployed.
  ludion watch [--dir <path>] [--apply] [--interval <seconds>] [--json]
      Repeat patch checks in the foreground (default 900 seconds). Ctrl+C cancels pending apply;
      a Docker step already in progress may finish before exit.
  ludion judge --before <dir> --after <dir> --files <changed,files> [--json]
      Judge an npm dependency update between two checkouts (preview, comments only): provenance,
      publisher, install scripts, malicious-package records, deprecation, new dependencies and the
      wait. Build and tests are not run. Exit 0: ready except build; 3: wait; 1: stop or undecidable
      (also when a lookup fails or --files is missing); 2: the inputs could not be read.
`;
async function main(argv) {
  const [command, ...rest] = argv;
  if (command && ["init", "scan", "patch", "watch"].includes(command)) return securityCli(command, rest);
  if (command === "judge") return judgeCli(rest);
  if (command === "sync" || command === "teach") {
    console.error(`ludion ${command} ended on 2026-10-28 with the lesson data it used. Ludion is now a security-update tool; run ludion help.`);
    return 2;
  }
  console.log(HELP);
  return command === void 0 || command === "help" || command === "--help" ? 0 : 2;
}
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`ludion: ${err.message}`);
    process.exitCode = 2;
  }
);
