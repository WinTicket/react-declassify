import { importName, memberRefName } from "../utils.js";
export function analyzeLibRef(path) {
  if (path.isIdentifier()) {
    const binding = path.scope.getBinding(path.node.name);
    if (!binding) {
      return;
    }
    const decl = binding.path;
    if (decl.isImportSpecifier()) {
      return {
        type: "import",
        kind: "named",
        source: decl.parentPath.node.source.value,
        specPath: decl,
        name: importName(decl.node.imported)
      };
    } else if (decl.isImportDefaultSpecifier()) {
      return {
        type: "import",
        kind: "named",
        source: decl.parentPath.node.source.value,
        specPath: decl,
        name: "default"
      };
    }
  } else if (path.isMemberExpression()) {
    const ns = path.get("object");
    if (!ns.isIdentifier()) {
      return;
    }
    const name = memberRefName(path.node);
    if (name == null) {
      return;
    }
    const binding = path.scope.getBinding(ns.node.name);
    if (!binding) {
      return {
        type: "global",
        globalName: ns.node.name,
        name
      };
    }
    const decl = binding.path;
    if (decl.isImportNamespaceSpecifier()) {
      return {
        type: "import",
        kind: "ns",
        source: decl.parentPath.node.source.value,
        specPath: decl,
        name
      };
    } else if (decl.isImportDefaultSpecifier() || decl.isImportSpecifier() && importName(decl.node.imported) === "default") {
      return {
        type: "import",
        kind: "ns",
        source: decl.parentPath.node.source.value,
        specPath: decl,
        name
      };
    }
  }
}
export function isReactRef(r) {
  return r.type === "import" && r.source === "react" || r.type === "global" && r.globalName === "React";
}