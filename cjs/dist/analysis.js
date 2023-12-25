"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "AnalysisError", {
  enumerable: true,
  get: function () {
    return _error.AnalysisError;
  }
});
Object.defineProperty(exports, "SoftErrorRepository", {
  enumerable: true,
  get: function () {
    return _error.SoftErrorRepository;
  }
});
exports.analyzeClass = analyzeClass;
Object.defineProperty(exports, "needAlias", {
  enumerable: true,
  get: function () {
    return _prop.needAlias;
  }
});
exports.needsProps = needsProps;
Object.defineProperty(exports, "preanalyzeClass", {
  enumerable: true,
  get: function () {
    return _pre.preanalyzeClass;
  }
});
var _error = require("./analysis/error.js");
var _class_fields = require("./analysis/class_fields.js");
var _state = require("./analysis/state.js");
var _utils = require("./utils.js");
var _prop = require("./analysis/prop.js");
var _local = require("./analysis/local.js");
var _user_defined = require("./analysis/user_defined.js");
var _effect = require("./analysis/effect.js");
var _pre = require("./analysis/pre.js");
const SPECIAL_STATIC_NAMES = new Set(["childContextTypes", "contextTypes", "contextType", "defaultProps", "getDerivedStateFromError", "getDerivedStateFromProps"]);
function analyzeClass(path, preanalysis, softErrors) {
  const locals = new _local.LocalManager(path);
  const {
    instanceFields: sites,
    staticFields,
    bindThisSites
  } = (0, _class_fields.analyzeClassFields)(path, softErrors);
  const propsObjAnalysis = (0, _utils.getAndDelete)(sites, "props") ?? {
    sites: []
  };
  const defaultPropsObjAnalysis = (0, _utils.getAndDelete)(staticFields, "defaultProps") ?? {
    sites: []
  };
  const stateObjAnalysis = (0, _utils.getAndDelete)(sites, "state") ?? {
    sites: []
  };
  const setStateAnalysis = (0, _utils.getAndDelete)(sites, "setState") ?? {
    sites: []
  };
  const states = (0, _state.analyzeState)(stateObjAnalysis, setStateAnalysis, locals, softErrors, preanalysis);
  const componentDidMount = (0, _utils.getAndDelete)(sites, "componentDidMount") ?? {
    sites: []
  };
  const componentDidUpdate = (0, _utils.getAndDelete)(sites, "componentDidUpdate") ?? {
    sites: []
  };
  const componentWillUnmount = (0, _utils.getAndDelete)(sites, "componentWillUnmount") ?? {
    sites: []
  };
  const renderAnalysis = (0, _utils.getAndDelete)(sites, "render") ?? {
    sites: []
  };
  analyzeOuterCapturings(path, locals);
  let renderPath = undefined;
  {
    for (const site of renderAnalysis.sites) {
      if (site.type === "expr") {
        softErrors.addThisError(site.thisPath);
      }
    }
    const init = renderAnalysis.sites.find(site => site.init);
    if (init) {
      if (init.path.isClassMethod()) {
        renderPath = init.path;
      }
    }
  }
  const userDefined = (0, _user_defined.analyzeUserDefined)(sites, softErrors);
  for (const [name] of staticFields) {
    if (!SPECIAL_STATIC_NAMES.has(name)) {
      throw new _error.AnalysisError(`Cannot transform static ${name}`);
    } else {
      throw new _error.AnalysisError(`Cannot transform static ${name}`);
    }
  }
  if (!renderPath) {
    throw new _error.AnalysisError(`Missing render method`);
  }
  const props = (0, _prop.analyzeProps)(propsObjAnalysis, defaultPropsObjAnalysis, locals, softErrors, preanalysis);
  (0, _user_defined.postAnalyzeCallbackDependencies)(userDefined, props, states, sites);
  for (const [name, propAnalysis] of props.props) {
    if ((0, _prop.needAlias)(propAnalysis)) {
      propAnalysis.newAliasName = locals.newLocal(name, propAnalysis.sites.map(site => site.path));
    }
  }
  const effects = (0, _effect.analyzeEffects)(componentDidMount, componentDidUpdate, componentWillUnmount, userDefined);
  const render = analyzeRender(renderPath, locals);
  for (const [name, stateAnalysis] of states.states.entries()) {
    const bindingPaths = stateAnalysis.sites.map(site => site.path);
    stateAnalysis.localName = locals.newLocal(name, bindingPaths);
    stateAnalysis.localSetterName = locals.newLocal(`set${name.replace(/^[a-z]/, s => s.toUpperCase())}`, bindingPaths);
  }
  for (const [name, field] of userDefined.fields) {
    field.localName = locals.newLocal(name, field.sites.map(site => site.path));
  }
  if (effects.cdmPath || effects.cduPath || effects.cwuPath) {
    effects.isMountedLocalName = locals.newLocal("isMounted", []);
    if (effects.cwuPath) {
      effects.cleanupLocalName = locals.newLocal("cleanup", []);
    }
  }
  return {
    name: preanalysis.name,
    typeParameters: preanalysis.typeParameters,
    superClassRef: preanalysis.superClassRef,
    isPure: preanalysis.isPure,
    propsTyping: preanalysis.props,
    locals,
    render,
    state: states,
    props,
    userDefined,
    effects,
    bindThisSites
  };
}
function analyzeRender(path, locals) {
  const renames = [];
  for (const [name, binding] of Object.entries(path.scope.bindings)) {
    if (locals.allRemovePaths.has(binding.path)) {
      // Already handled as an alias
      continue;
    }
    const newName = locals.newLocal(name, []);
    renames.push({
      scope: binding.scope,
      oldName: name,
      newName
    });
  }
  return {
    path,
    renames
  };
}
function analyzeOuterCapturings(classPath, locals) {
  const capturings = new Set();
  function visitIdent(path) {
    const binding = path.scope.getBinding(path.node.name);
    if (!binding || binding.path.isAncestor(classPath)) {
      capturings.add(path.node.name);
      locals.markCaptured(path.node.name);
    }
  }
  classPath.get("body").traverse({
    Identifier(path) {
      if (path.isReferencedIdentifier()) {
        visitIdent(path);
      }
    },
    JSXIdentifier(path) {
      if (path.isReferencedIdentifier()) {
        visitIdent(path);
      }
    }
  });
  return capturings;
}
function needsProps(analysis) {
  return analysis.props.sites.length > 0;
}