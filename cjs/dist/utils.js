"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.assignReturnType = assignReturnType;
exports.assignTypeAnnotation = assignTypeAnnotation;
exports.assignTypeArguments = assignTypeArguments;
exports.assignTypeParameters = assignTypeParameters;
exports.getAndDelete = getAndDelete;
exports.getOr = getOr;
exports.importName = importName;
exports.isClassAccessorProperty = isClassAccessorProperty;
exports.isClassMethodLike = isClassMethodLike;
exports.isClassMethodOrDecl = isClassMethodOrDecl;
exports.isClassPropertyLike = isClassPropertyLike;
exports.isNamedClassElement = isNamedClassElement;
exports.isStaticBlock = isStaticBlock;
exports.isTS = isTS;
exports.memberFromDecl = memberFromDecl;
exports.memberName = memberName;
exports.memberRefName = memberRefName;
exports.nonNullPath = nonNullPath;
function getOr(m, k, getDefault) {
  if (m.has(k)) {
    return m.get(k);
  } else {
    const v = getDefault();
    m.set(k, v);
    return v;
  }
}
function getAndDelete(m, k) {
  const v = m.get(k);
  m.delete(k);
  return v;
}
function memberName(member) {
  const computed = member.type === "ClassPrivateMethod" || member.type === "ClassPrivateProperty" ? false : member.computed;
  if (computed && member.key.type === "StringLiteral") {
    return member.key.value;
  } else if (!computed && member.key.type === "Identifier") {
    return member.key.name;
  }
}
function memberRefName(member) {
  if (member.computed && member.property.type === "StringLiteral") {
    return member.property.value;
  } else if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
}
function importName(name) {
  if (name.type === "StringLiteral") {
    return name.value;
  } else {
    return name.name;
  }
}
function memberFromDecl(babel, object, decl) {
  const {
    types: t
  } = babel;
  if (decl.type === "ClassPrivateMethod" || decl.type === "ClassPrivateProperty") {
    return t.memberExpression(object, t.stringLiteral(decl.key.id.name), true);
  }
  if (decl.key.type === "PrivateName") {
    return t.memberExpression(object, t.stringLiteral(decl.key.id.name), true);
  }
  return t.memberExpression(object, decl.key, decl.computed);
}
function nonNullPath(path) {
  return path.node ? path : undefined;
}
function isNamedClassElement(path) {
  return path.isClassProperty() || path.isClassPrivateProperty() || path.isClassMethod() || path.isClassPrivateMethod() || path.isTSDeclareMethod() || isClassAccessorProperty(path);
}
function isClassPropertyLike(path) {
  return path.isClassProperty() || path.isClassPrivateProperty();
}
function isClassMethodLike(path) {
  return path.isClassMethod() || path.isClassPrivateMethod();
}
function isClassMethodOrDecl(path) {
  return path.isClassMethod() || path.isClassPrivateMethod() || path.isTSDeclareMethod();
}
function isStaticBlock(path) {
  return path.node.type === "StaticBlock";
}
function isClassAccessorProperty(path) {
  return path.node.type === "ClassAccessorProperty";
}
function isTS(state) {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}
function assignTypeAnnotation(node, typeAnnotation) {
  return Object.assign(node, {
    typeAnnotation
  });
}
function assignReturnType(node, returnType) {
  return Object.assign(node, {
    returnType
  });
}
function assignTypeParameters(node, typeParameters) {
  return Object.assign(node, {
    typeParameters
  });
}
function assignTypeArguments(node, typeParameters) {
  return Object.assign(node, {
    typeParameters
  });
}