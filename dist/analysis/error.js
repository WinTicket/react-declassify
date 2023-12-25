export class SoftErrorRepository {
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
export class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}