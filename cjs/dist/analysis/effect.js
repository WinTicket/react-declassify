"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.analyzeEffects = analyzeEffects;
var _error = require("./error.js");
function analyzeEffects(componentDidMount, componentDidUpdate, componentWillUnmount, userDefined) {
  const cdmInit = componentDidMount.sites.find(site => site.init);
  const cduInit = componentDidUpdate.sites.find(site => site.init);
  const cwuInit = componentWillUnmount.sites.find(site => site.init);
  if (componentDidMount.sites.some(site => !site.init)) {
    throw new _error.AnalysisError("Do not use componentDidMount by yourself");
  }
  if (componentDidUpdate.sites.some(site => !site.init)) {
    throw new _error.AnalysisError("Do not use componentDidUpdate by yourself");
  }
  if (componentWillUnmount.sites.some(site => !site.init)) {
    throw new _error.AnalysisError("Do not use componentWillUnmount by yourself");
  }
  let cdmPath = undefined;
  let cduPath = undefined;
  let cwuPath = undefined;
  if (cdmInit) {
    if (!cdmInit.path.isClassMethod()) {
      throw new _error.AnalysisError("Not a class method: componentDidMount");
    }
    if (cdmInit.path.node.params.length > 0) {
      throw new _error.AnalysisError("Invalid parameter of componentDidMount");
    }
    cdmPath = cdmInit.path;
  }
  if (cduInit) {
    if (!cduInit.path.isClassMethod()) {
      throw new _error.AnalysisError("Not a class method: componentDidUpdate");
    }
    if (cduInit.path.node.params.length > 0) {
      throw new _error.AnalysisError("Not supported: componentDidUpdate parameters");
    }
    cduPath = cduInit.path;
  }
  if (cwuInit) {
    if (!cwuInit.path.isClassMethod()) {
      throw new _error.AnalysisError("Not a class method: componentWillUnmount");
    }
    if (cwuInit.path.node.params.length > 0) {
      throw new _error.AnalysisError("Invalid parameter of componentWillUnmount");
    }
    cwuPath = cwuInit.path;
  }
  for (const [name, field] of userDefined.fields) {
    if (field.type === "user_defined_function" && field.sites.some(site => site.type === "expr" && site.owner === "componentWillUnmount" && !site.path.parentPath.isCallExpression())) {
      // A user-defined function is used without immediately calling in componentWillUnmount.
      // This is likely the following idiom:
      //
      // ```js
      // onMouseOver = () => {
      //   ...
      // }
      // componentDidMount() {
      //   this.div.addEventListener("mouseover", this.onMouseOver);
      // }
      // componentWillUnmount() {
      //   this.div.removeEventListener("mouseover", this.onMouseOver);
      // }
      // ```
      //
      // It may break in our "raw effect" transformation
      // because function identity may change over time.
      //
      // We will implement a separate paths for the patterns above,
      // but for now we just error out to avoid risks.

      throw new _error.AnalysisError(`Possible event unregistration of ${name} in componentWillUnmount`);
    }
  }
  return {
    cdmPath,
    cduPath,
    cwuPath
  };
}