"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.analyzeProps = analyzeProps;
exports.needAlias = needAlias;
var _utils = require("../utils.js");
var _error = require("./error.js");
var _class_fields = require("./class_fields.js");
var _track_member = require("./track_member.js");
/**
 * Detects assignments that expand `this.props` to variables, like:
 *
 * ```js
 * const { foo, bar } = this.props;
 * ```
 *
 * or:
 *
 * ```js
 * const foo = this.props.foo;
 * const bar = this.props.bar;
 * ```
 */
function analyzeProps(propsObjAnalysis, defaultPropsObjAnalysis, locals, softErrors, preanalysis) {
  const defaultProps = analyzeDefaultProps(defaultPropsObjAnalysis);
  const newObjSites = [];
  const props = new Map();
  const getProp = name => (0, _utils.getOr)(props, name, () => ({
    sites: [],
    aliases: []
  }));
  for (const site of propsObjAnalysis.sites) {
    if (site.type !== "expr" || site.hasWrite) {
      (0, _class_fields.addClassFieldError)(site, softErrors);
      continue;
    }
    const memberAnalysis = (0, _track_member.trackMember)(site.path);
    const parentSite = {
      path: site.path,
      owner: site.owner,
      decomposedAsAliases: false,
      child: undefined
    };
    if (memberAnalysis.fullyDecomposed && memberAnalysis.memberAliases) {
      newObjSites.push(parentSite);
      for (const [name, aliasing] of memberAnalysis.memberAliases) {
        getProp(name).aliases.push({
          scope: aliasing.scope,
          localName: aliasing.localName,
          owner: site.owner
        });
        locals.reserveRemoval(aliasing.idPath);
      }
      parentSite.decomposedAsAliases = true;
    } else {
      if (defaultProps && !memberAnalysis.memberExpr) {
        (0, _class_fields.addClassFieldError)(site, softErrors);
        continue;
      }
      newObjSites.push(parentSite);
      if (memberAnalysis.memberExpr) {
        const child = {
          path: memberAnalysis.memberExpr.path,
          parent: parentSite,
          owner: site.owner,
          // `enabled` will also be turned on later in callback analysis
          enabled: !!defaultProps
        };
        parentSite.child = child;
        getProp(memberAnalysis.memberExpr.name).sites.push(child);
      }
    }
  }
  for (const [name, propTyping] of preanalysis.propsEach) {
    getProp(name).typing = propTyping;
  }
  if (defaultProps) {
    for (const [name, defaultValue] of defaultProps) {
      getProp(name).defaultValue = defaultValue;
    }
  }
  const allAliases = Array.from(props.values()).flatMap(prop => prop.aliases);
  return {
    hasDefaults: !!defaultProps,
    sites: newObjSites,
    props,
    allAliases
  };
}
function needAlias(prop) {
  return prop.aliases.length > 0 || prop.sites.some(s => s.enabled);
}
function analyzeDefaultProps(defaultPropsAnalysis) {
  for (const site of defaultPropsAnalysis.sites) {
    if (!site.init) {
      throw new _error.AnalysisError(`Invalid use of static defaultProps`);
    }
  }
  const defaultPropsFields = new Map();
  const init = defaultPropsAnalysis.sites.find(site => site.init);
  if (!init) {
    return;
  }
  const init_ = init.init;
  if (init_.type !== "init_value") {
    throw new _error.AnalysisError("Non-analyzable defaultProps initializer");
  }
  const initPath = init_.valuePath;
  if (!initPath.isObjectExpression()) {
    throw new _error.AnalysisError("Non-analyzable defaultProps initializer");
  }
  for (const fieldPath of initPath.get("properties")) {
    if (!fieldPath.isObjectProperty()) {
      throw new _error.AnalysisError("Non-analyzable defaultProps initializer");
    }
    const stateName = (0, _utils.memberName)(fieldPath.node);
    if (stateName == null) {
      throw new _error.AnalysisError("Non-analyzable defaultProps initializer");
    }
    const fieldInitPath = fieldPath.get("value");
    if (!fieldInitPath.isExpression()) {
      throw new _error.AnalysisError("Non-analyzable defaultProps initializer");
    }
    defaultPropsFields.set(stateName, fieldInitPath);
  }
  return defaultPropsFields.size > 0 ? defaultPropsFields : undefined;
}