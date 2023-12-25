export function getOr(m, k, getDefault) {
  if (m.has(k)) {
    return m.get(k);
  } else {
    const v = getDefault();
    m.set(k, v);
    return v;
  }
}
export function getAndDelete(m, k) {
  const v = m.get(k);
  m.delete(k);
  return v;
}
export function memberName(member) {
  const computed = member.type === "ClassPrivateMethod" || member.type === "ClassPrivateProperty" ? false : member.computed;
  if (computed && member.key.type === "StringLiteral") {
    return member.key.value;
  } else if (!computed && member.key.type === "Identifier") {
    return member.key.name;
  }
}
export function memberRefName(member) {
  if (member.computed && member.property.type === "StringLiteral") {
    return member.property.value;
  } else if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
}
export function importName(name) {
  if (name.type === "StringLiteral") {
    return name.value;
  } else {
    return name.name;
  }
}
export function memberFromDecl(babel, object, decl) {
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
export function nonNullPath(path) {
  return path.node ? path : undefined;
}
export function isNamedClassElement(path) {
  return path.isClassProperty() || path.isClassPrivateProperty() || path.isClassMethod() || path.isClassPrivateMethod() || path.isTSDeclareMethod() || isClassAccessorProperty(path);
}
export function isClassPropertyLike(path) {
  return path.isClassProperty() || path.isClassPrivateProperty();
}
export function isClassMethodLike(path) {
  return path.isClassMethod() || path.isClassPrivateMethod();
}
export function isClassMethodOrDecl(path) {
  return path.isClassMethod() || path.isClassPrivateMethod() || path.isTSDeclareMethod();
}
export function isStaticBlock(path) {
  return path.node.type === "StaticBlock";
}
export function isClassAccessorProperty(path) {
  return path.node.type === "ClassAccessorProperty";
}
export function isTS(state) {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}
export function assignTypeAnnotation(node, typeAnnotation) {
  return Object.assign(node, {
    typeAnnotation
  });
}
export function assignReturnType(node, returnType) {
  return Object.assign(node, {
    returnType
  });
}
export function assignTypeParameters(node, typeParameters) {
  return Object.assign(node, {
    typeParameters
  });
}
export function assignTypeArguments(node, typeParameters) {
  return Object.assign(node, {
    typeParameters
  });
}