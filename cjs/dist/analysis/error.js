"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SoftErrorRepository = exports.AnalysisError = void 0;
class SoftErrorRepository {
  errors = [];
  addThisError(thisPath) {
    this.errors.push({
      type: "invalid_this",
      path: thisPath
    });
  }
  addDeclError(declPath) {
    this.errors.push({
      type: "invalid_decl",
      path: declPath
    });
  }
}
exports.SoftErrorRepository = SoftErrorRepository;
class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}
exports.AnalysisError = AnalysisError;