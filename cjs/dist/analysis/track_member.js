"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.trackMember = trackMember;
var _utils = require("../utils.js");
function trackMember(path) {
  let memberExpr = undefined;
  let memberAliases = undefined;
  let fullyDecomposed = false;
  const path1 = path.parentPath;
  if (path1.isMemberExpression({
    object: path.node
  })) {
    // Check for `<expr>.foo`
    const name = (0, _utils.memberRefName)(path1.node);
    if (name != null) {
      memberExpr = {
        name,
        path: path1
      };
      const idPath = getSimpleAliasing(path1);
      if (idPath) {
        // Found `const foo = <expr>.foo;`
        memberAliases = new Map();
        memberAliases.set(name, {
          scope: idPath.scope,
          localName: idPath.node.name,
          idPath
        });
        fullyDecomposed = true;
      }
    }
  } else if (path1.isVariableDeclarator({
    init: path.node
  })) {
    const path2 = path1.parentPath;
    if (path2.isVariableDeclaration({
      kind: "const"
    })) {
      // Check for `const { foo } = <expr>;`
      const lvPath = path1.get("id");
      if (lvPath.isObjectPattern()) {
        fullyDecomposed = true;
        memberAliases = new Map();
        for (const propPath of lvPath.get("properties")) {
          let ok = false;
          if (propPath.isObjectProperty()) {
            const name = (0, _utils.memberName)(propPath.node);
            const valuePath = propPath.get("value");
            if (name != null && valuePath.isIdentifier()) {
              ok = true;
              memberAliases.set(name, {
                scope: valuePath.scope,
                localName: valuePath.node.name,
                idPath: valuePath
              });
            }
          }
          fullyDecomposed &&= ok;
        }
      }
    }
  }
  return {
    path,
    memberExpr,
    memberAliases,
    fullyDecomposed
  };
}
function getSimpleAliasing(path) {
  const path1 = path.parentPath;
  if (path1.isVariableDeclarator({
    init: path.node
  })) {
    const path2 = path1.parentPath;
    if (path2.isVariableDeclaration({
      kind: "const"
    })) {
      const idPath = path1.get("id");
      if (idPath.isIdentifier()) {
        return idPath;
      }
    }
  }
  return undefined;
}