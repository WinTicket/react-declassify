"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.analyzeState = analyzeState;
var _utils = require("../utils.js");
var _error = require("./error.js");
var _class_fields = require("./class_fields.js");
var _track_member = require("./track_member.js");
function analyzeState(stateObjAnalysis, setStateAnalysis, locals, softErrors, preanalysis) {
  const states = new Map();
  const getState = name => (0, _utils.getOr)(states, name, () => ({
    sites: []
  }));
  const init = stateObjAnalysis.sites.find(site => site.init);
  if (init) {
    const init_ = init.init;
    if (init_.type !== "init_value") {
      throw new _error.AnalysisError("Non-analyzable state initializer");
    }
    const initPath = init_.valuePath;
    if (!initPath.isObjectExpression()) {
      throw new _error.AnalysisError("Non-analyzable state initializer");
    }
    for (const fieldPath of initPath.get("properties")) {
      if (!fieldPath.isObjectProperty()) {
        throw new _error.AnalysisError("Non-analyzable state initializer");
      }
      const stateName = (0, _utils.memberName)(fieldPath.node);
      if (stateName == null) {
        throw new _error.AnalysisError("Non-analyzable state initializer");
      }
      const fieldInitPath = fieldPath.get("value");
      if (!fieldInitPath.isExpression()) {
        throw new _error.AnalysisError("Non-analyzable state initializer");
      }
      const state = getState(stateName);
      state.sites.push({
        type: "state_init",
        path: fieldPath,
        valuePath: fieldInitPath
      });
    }
  }
  for (const site of stateObjAnalysis.sites) {
    if (site.init) {
      continue;
    }
    if (site.type !== "expr" || site.hasWrite) {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
    const memberAnalysis = (0, _track_member.trackMember)(site.path);
    if (memberAnalysis.fullyDecomposed && memberAnalysis.memberAliases) {
      for (const [name, aliasInfo] of memberAnalysis.memberAliases) {
        const binding = aliasInfo.scope.getBinding(aliasInfo.localName);
        locals.reserveRemoval(binding.path);
        for (const path of binding.referencePaths) {
          if (!path.isExpression()) {
            throw new Error("referencePath contains non-Expression");
          }
          getState(name).sites.push({
            type: "expr",
            path,
            owner: site.owner
          });
        }
      }
    } else if (memberAnalysis.memberExpr) {
      getState(memberAnalysis.memberExpr.name).sites.push({
        type: "expr",
        path: memberAnalysis.memberExpr.path,
        owner: site.owner
      });
    } else {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
  }
  const setStateSites = [];
  setStateLoop: for (const site of setStateAnalysis.sites) {
    if (site.type !== "expr" || site.hasWrite) {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
    const gpPath = site.path.parentPath;
    if (!gpPath.isCallExpression()) {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
    const args = gpPath.get("arguments");
    if (args.length !== 1) {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
    const arg0 = args[0];
    if (arg0.isObjectExpression()) {
      const props = arg0.get("properties");
      const fields = [];
      for (const prop of props) {
        if (!prop.isObjectProperty()) {
          (0, _class_fields.addClassFieldError)(site, softErrors);
          continue setStateLoop;
        }
        const setStateName = (0, _utils.memberName)(prop.node);
        if (setStateName == null) {
          (0, _class_fields.addClassFieldError)(site, softErrors);
          continue setStateLoop;
        }
        // Ensure the state exists
        getState(setStateName);
        fields.push({
          name: setStateName,
          valuePath: prop.get("value")
        });
      }
      setStateSites.push({
        path: gpPath,
        fields
      });
    } else {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
  }
  for (const [name, stateType] of preanalysis.states) {
    const state = getState(name);
    if (stateType.isTSPropertySignature()) {
      const annot = stateType.get("typeAnnotation");
      if (annot.isTSTypeAnnotation()) {
        state.typeAnnotation = {
          type: "simple",
          path: annot.get("typeAnnotation")
        };
      }
    } else if (stateType.isTSMethodSignature()) {
      const params = stateType.get("parameters");
      const returnAnnot = stateType.get("typeAnnotation");
      if (returnAnnot.isTSTypeAnnotation()) {
        state.typeAnnotation = {
          type: "method",
          params,
          returnType: returnAnnot.get("typeAnnotation")
        };
      }
    }
  }
  for (const [name, state] of states.entries()) {
    const numInits = state.sites.reduce((n, site) => n + Number(site.type === "state_init"), 0);
    if (numInits > 1) {
      throw new _error.AnalysisError(`${name} is initialized more than once`);
    }
    state.init = state.sites.find(site => site.type === "state_init");
  }
  return {
    states,
    setStateSites
  };
}