// This file contains analysis paths for class heads.

import { memberName, nonNullPath } from "../utils.js";
import { analyzeLibRef, isReactRef } from "./lib.js";
/**
 * Analyzes a class header to determine if it should be transformed.
 *
 * @param path the pass to the class node
 * @returns an object containing analysis result, if the class should be transformed
 */
export function preanalyzeClass(path) {
  if (path.node.leadingComments?.some(comment => /react-declassify-disable/.test(comment.value))) {
    // Explicitly disabled
    //
    // E.g.
    // ```js
    // /* react-declassify-disable */
    // class MyComponent extends Component {}
    // ```
    return;
  }
  if (path.node.leadingComments?.some(comment => comment.type === "CommentBlock" && /^\*/.test(comment.value) && /@abstract/.test(comment.value)) || path.node.abstract) {
    // This is an abstract class to be inherited; do not attempt transformation.
    //
    // E.g.
    // ```js
    // abstract class MyComponent extends Component {}
    // /** @abstract */
    // class MyComponent2 extends Component {}
    // ```
    return;
  }

  // Check if it extends React.Component or React.PureComponent
  const superClass = nonNullPath(path.get("superClass"));
  if (!superClass) {
    // Not a subclass
    return;
  }
  const superClassRef = analyzeLibRef(superClass);
  if (
  // Subclass of an unknown class
  !superClassRef ||
  // Not a react thing, presumably
  !isReactRef(superClassRef) ||
  // React.Something but I'm not sure what it is
  !(superClassRef.name === "Component" || superClassRef.name === "PureComponent")) {
    return;
  }

  // OK, now we are going to transform the component
  const name = path.node.id;
  const typeParameters_ = nonNullPath(path.get("typeParameters"));
  const typeParameters = typeParameters_?.isTSTypeParameterDeclaration() ? typeParameters_ : undefined;
  const isPure = superClassRef.name === "PureComponent";
  let props;
  let propsEach = undefined;
  let states = undefined;
  const superTypeParameters = path.get("superTypeParameters");
  if (superTypeParameters.isTSTypeParameterInstantiation()) {
    // Analyze P and S as in React.Component<P, S>
    const params = superTypeParameters.get("params");
    if (params.length > 0) {
      props = params[0];
      propsEach = decompose(params[0]);
    }
    if (params.length > 1) {
      const stateParamPath = params[1];
      states = decompose(stateParamPath);
    }
  }
  propsEach ??= new Map();
  states ??= new Map();
  return {
    name,
    typeParameters,
    superClassRef,
    isPure,
    props,
    propsEach,
    states
  };
}

/**
 * Tries to decompose a type into a set of property signatures.
 *
 * @param path a type
 * @returns a map containing property signatures and method signatures
 */
function decompose(path) {
  const aliasPath = resolveAlias(path);
  const members = aliasPath.isTSTypeLiteral() ? aliasPath.get("members") : aliasPath.isTSInterfaceBody() ? aliasPath.get("body") : undefined;
  const decomposed = new Map();
  if (members) {
    for (const member of members) {
      if (member.isTSPropertySignature() || member.isTSMethodSignature()) {
        const name = memberName(member.node);
        if (name != null) {
          decomposed.set(name, member);
        }
      }
    }
  }
  return decomposed;
}

/**
 * Jumps to the definition if the type node references other type.
 *
 * @param path a type to resolve
 * @returns A type node or a node containing an `interface` definition
 */
function resolveAlias(path) {
  if (path.isTSTypeReference()) {
    const typeNamePath = path.get("typeName");
    if (typeNamePath.isIdentifier()) {
      // Resolve identifier using heuristics.
      // Babel does not have full scope resolver for types.
      const name = typeNamePath.node.name;
      let scope = typeNamePath.scope;
      while (scope) {
        if (scope.path.isBlockStatement() || scope.path.isProgram()) {
          const path_ = scope.path;
          for (const body of path_.get("body")) {
            if (body.isTSTypeAliasDeclaration() && body.node.id.name === name) {
              return body.get("typeAnnotation");
            } else if (body.isTSInterfaceDeclaration() && body.node.id.name === name) {
              return body.get("body");
            }
          }
        }
        scope = scope.parent;
      }
    }
  }
  return path;
}