// This file contains analysis for class fields (`this.foo` and `C.foo`) where `C` is the class,
// regardless of whether this is a special one (`this.props`) or a user-defined one (`this.foo`).
//
// Both the declarations and the usages are collected.

import { getOr, isClassAccessorProperty, isClassMethodLike, isClassMethodOrDecl, isClassPropertyLike, isNamedClassElement, isStaticBlock, memberName, memberRefName, nonNullPath } from "../utils.js";
import { AnalysisError } from "./error.js";

/**
 * Aggregated result of class field analysis.
 */

/**
 * Collect declarations and uses of the following:
 *
 * - Instance fields ... `this.foo`
 * - Static fields ... `C.foo`, where `C` is the class
 */
export function analyzeClassFields(path, softErrors) {
  const instanceFields = new Map();
  const getInstanceField = name => getOr(instanceFields, name, () => ({
    sites: []
  }));
  const staticFields = new Map();
  const getStaticField = name => getOr(staticFields, name, () => ({
    sites: []
  }));
  let constructor = undefined;
  const bodies = [];
  // 1st pass: look for class field definitions
  for (const itemPath of path.get("body").get("body")) {
    if (isNamedClassElement(itemPath)) {
      // The element is a class method or a class field (in a general sense)
      const isStatic = itemPath.node.static;
      const name = memberName(itemPath.node);
      if (name == null) {
        if (isStatic) {
          throw new AnalysisError(`Unnamed class element`);
        } else {
          softErrors.addDeclError(itemPath);
          continue;
        }
      }
      const field = isStatic ? getStaticField(name) : getInstanceField(name);
      if (isClassPropertyLike(itemPath)) {
        // Class field.
        // - May have an initializer: `foo = 42;` or not: `foo;`
        // - May have a type annotation: `foo: number;` or not: `foo;`
        const valuePath = nonNullPath(itemPath.get("value"));
        const typeAnnotation = itemPath.get("typeAnnotation");
        const typeAnnotation_ = typeAnnotation.isTSTypeAnnotation() ? typeAnnotation : undefined;
        field.sites.push({
          type: "decl",
          path: itemPath,
          owner: undefined,
          typing: typeAnnotation_ ? {
            type: "type_value",
            valueTypePath: typeAnnotation_.get("typeAnnotation")
          } : undefined,
          init: valuePath ? {
            type: "init_value",
            valuePath
          } : undefined,
          hasWrite: undefined,
          hasSideEffect: !!itemPath.node.value && estimateSideEffect(itemPath.node.value)
        });
        if (valuePath) {
          // Initializer should be analyzed in step 2 too (considered to be in the constructor)
          bodies.push({
            owner: valuePath.isFunctionExpression() || valuePath.isArrowFunctionExpression() ? name : undefined,
            path: valuePath
          });
        }
      } else if (isClassMethodOrDecl(itemPath)) {
        // Class method, constructor, getter/setter, or an accessor (those that will be introduced in the decorator proposal).
        //
        // - In TS, it may lack the implementation (i.e. TSDeclareMethod)
        const kind = itemPath.node.kind ?? "method";
        if (kind === "method") {
          field.sites.push({
            type: "decl",
            path: itemPath,
            owner: undefined,
            // We put `typing` here only when it is type-only
            typing: itemPath.isTSDeclareMethod() ? {
              type: "type_method",
              methodDeclPath: itemPath
            } : undefined,
            init: isClassMethodLike(itemPath) ? {
              type: "init_method",
              methodPath: itemPath
            } : undefined,
            hasWrite: undefined,
            hasSideEffect: false
          });
          // Analysis for step 2
          if (isClassMethodLike(itemPath)) {
            for (const paramPath of itemPath.get("params")) {
              bodies.push({
                owner: name,
                path: paramPath
              });
            }
            bodies.push({
              owner: name,
              path: itemPath.get("body")
            });
          }
        } else if (kind === "get" || kind === "set") {
          throw new AnalysisError(`Not implemented yet: getter / setter`);
        } else if (kind === "constructor") {
          if (isStatic) {
            throw new Error("static constructor found");
          }
          constructor = itemPath;
        } else {
          throw new AnalysisError(`Not implemented yet: ${kind}`);
        }
      } else if (isClassAccessorProperty(itemPath)) {
        throw new AnalysisError(`Not implemented yet: class accessor property`);
      }
    } else if (isStaticBlock(itemPath)) {
      throw new AnalysisError(`Not implemented yet: static block`);
    } else if (itemPath.isTSIndexSignature()) {
      // Ignore
    } else {
      throw new AnalysisError(`Unknown class element`);
    }
  }

  // 1st pass additional work: field initialization in constructor
  if (constructor) {
    // Only `constructor(props)` is allowed.
    // TODO: accept context as well
    if (constructor.node.params.length > 1) {
      throw new AnalysisError(`Constructor has too many parameters`);
    } else if (constructor.node.params.length < 1) {
      throw new AnalysisError(`Constructor has too few parameters`);
    }
    const param = constructor.node.params[0];
    if (param.type !== "Identifier") {
      throw new AnalysisError(`Invalid constructor parameters`);
    }
    const stmts = constructor.get("body").get("body");

    // Check super() call
    // Must be super(props) or super(props, context)
    const superCallIndex = stmts.findIndex(stmt => stmt.node.type === "ExpressionStatement" && stmt.node.expression.type === "CallExpression" && stmt.node.expression.callee.type === "Super");
    if (superCallIndex === -1) {
      throw new AnalysisError(`No super call`);
    } else if (superCallIndex > 0) {
      throw new AnalysisError(`No immediate super call`);
    }
    const superCall = stmts[superCallIndex];
    const superCallArgs = superCall.node.expression.arguments;
    if (superCallArgs.length > 1) {
      throw new AnalysisError(`Too many arguments for super()`);
    } else if (superCallArgs.length < 1) {
      throw new AnalysisError(`Too few arguments for super()`);
    }
    const superCallArg = superCallArgs[0];
    if (superCallArg.type !== "Identifier" || superCallArg.name !== param.name) {
      throw new AnalysisError(`Invalid argument for super()`);
    }

    // Analyze init statements (must be in the form of `this.foo = expr;`)
    const initStmts = stmts.slice(superCallIndex + 1);
    for (const stmt of initStmts) {
      if (!(stmt.node.type === "ExpressionStatement" && stmt.node.expression.type === "AssignmentExpression" && stmt.node.expression.operator === "=" && stmt.node.expression.left.type === "MemberExpression" && stmt.node.expression.left.object.type === "ThisExpression")) {
        throw new AnalysisError(`Non-analyzable initialization in constructor`);
      }
      const exprPath = stmt.get("expression");
      const name = memberRefName(stmt.node.expression.left);
      if (name == null) {
        throw new AnalysisError(`Non-analyzable initialization in constructor`);
      }
      // TODO: check for parameter/local variable reference

      const field = getInstanceField(name);
      field.sites.push({
        type: "decl",
        path: exprPath,
        owner: undefined,
        typing: undefined,
        init: {
          type: "init_value",
          valuePath: exprPath.get("right")
        },
        hasWrite: undefined,
        hasSideEffect: estimateSideEffect(stmt.node.expression.right)
      });
      bodies.push({
        owner: name,
        path: exprPath.get("right")
      });
    }
  }

  // 2nd pass: look for uses within items
  const bindThisSites = [];
  function traverseItem(owner, path) {
    traverseThis(path, thisPath => {
      // Ensure this is part of `this.foo`
      const thisMemberPath = thisPath.parentPath;
      if (!thisMemberPath.isMemberExpression({
        object: thisPath.node
      })) {
        // Check for bind arguments: `this.foo.bind(this)`
        if (thisMemberPath.isCallExpression() && thisMemberPath.node.arguments[0] === thisPath.node && thisMemberPath.node.callee.type === "MemberExpression" && memberRefName(thisMemberPath.node.callee) === "bind" && thisMemberPath.node.callee.object.type === "MemberExpression" && thisMemberPath.node.callee.object.object.type === "ThisExpression") {
          bindThisSites.push({
            bindsMore: thisMemberPath.node.arguments.length > 1,
            thisArgPath: thisPath,
            binderPath: thisMemberPath,
            bindeePath: thisMemberPath.get("callee").get("object"),
            // Checked later
            isSelfBindingInitialization: false
          });
          return;
        }
        softErrors.addThisError(thisPath);
        return;
      }
      const name = memberRefName(thisMemberPath.node);
      if (name == null) {
        softErrors.addThisError(thisPath);
        return;
      }
      const field = getInstanceField(name);
      const thisMemberParentPath = thisMemberPath.parentPath;
      const hasWrite =
      // `this.foo = 0;` (incl. operator assignment)
      thisMemberParentPath.isAssignmentExpression({
        left: thisMemberPath.node
      }) ||
      // `delete this.foo;`
      thisMemberParentPath.isUnaryExpression({
        operator: "delete",
        argument: thisMemberPath.node
      });
      field.sites.push({
        type: "expr",
        owner,
        path: thisMemberPath,
        thisPath,
        typing: undefined,
        init: undefined,
        hasWrite,
        hasSideEffect: undefined
      });
    });
  }
  for (const body of bodies) {
    traverseItem(body.owner, body.path);
  }

  // Special handling for self-binding initialization (`this.foo = this.foo.bind(this)`)
  for (const [name, field] of instanceFields) {
    field.sites = field.sites.filter(site => {
      if (site.type === "decl" && site.init?.type === "init_value") {
        const valuePath = site.init.valuePath;
        const bindThisSite = bindThisSites.find(binder => binder.binderPath === valuePath);
        if (bindThisSite && !bindThisSite.bindsMore && memberRefName(bindThisSite.bindeePath.node) === name) {
          bindThisSite.isSelfBindingInitialization = true;
          // Skip the self-binding initialization (lhs)
          return false;
        }
      }
      return true;
    });
  }
  for (const [, field] of instanceFields) {
    field.sites = field.sites.filter(site => {
      if (site.type === "expr") {
        const bindThisSite = bindThisSites.find(binder => binder.bindeePath === site.path);
        if (bindThisSite?.isSelfBindingInitialization) {
          // Skip the self-binding initialization (rhs)
          return false;
        }
      }
      return true;
    });
  }

  // Post validation
  for (const [name, field] of instanceFields) {
    if (field.sites.length === 0) {
      instanceFields.delete(name);
    }
    const numInits = field.sites.reduce((n, site) => n + Number(!!site.init), 0);
    if (numInits > 1) {
      throw new AnalysisError(`${name} is initialized more than once`);
    }
    const numTypes = field.sites.reduce((n, site) => n + Number(!!site.typing), 0);
    if (numTypes > 1) {
      throw new AnalysisError(`${name} is declared more than once`);
    }
  }
  for (const [name, field] of staticFields) {
    if (field.sites.length === 0) {
      instanceFields.delete(name);
    }
    const numInits = field.sites.reduce((n, site) => n + Number(!!site.init), 0);
    if (numInits > 1) {
      throw new AnalysisError(`static ${name} is initialized more than once`);
    }
    const numTypes = field.sites.reduce((n, site) => n + Number(!!site.typing), 0);
    if (numTypes > 1) {
      throw new AnalysisError(`static ${name} is declared more than once`);
    }
  }
  return {
    instanceFields,
    staticFields,
    bindThisSites
  };
}
export function addClassFieldError(site, softErrors) {
  if (site.type === "decl") {
    if (isNamedClassElement(site.path)) {
      softErrors.addDeclError(site.path);
    } else if (site.path.isAssignmentExpression()) {
      const left = site.path.get("left");
      const object = left.get("object");
      softErrors.addThisError(object);
    } else {
      throw new Error(`Unreachable: invalid type: ${site.path.node.type}`);
    }
  } else {
    softErrors.addThisError(site.thisPath);
  }
}
function traverseThis(path, visit) {
  path.traverse({
    ThisExpression: visit,
    FunctionDeclaration(path) {
      path.skip();
    },
    FunctionExpression(path) {
      path.skip();
    },
    ClassDeclaration(path) {
      path.skip();
    },
    ClassExpression(path) {
      path.skip();
    },
    ObjectMethod(path) {
      path.skip();
    }
  });
}
function estimateSideEffect(expr) {
  switch (expr.type) {
    case "NullLiteral":
    case "BooleanLiteral":
    case "NumericLiteral":
    case "BigIntLiteral":
    case "Identifier":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return false;
    case "MemberExpression":
      // Assume `foo.bar` to be pure
      return estimateSideEffect(expr.object) || expr.property.type !== "PrivateName" && estimateSideEffect(expr.property);
    case "UnaryExpression":
      switch (expr.operator) {
        case "void":
        case "!":
        case "+":
        case "-":
        case "~":
        case "typeof":
          return estimateSideEffect(expr.argument);
      }
      break;
    case "BinaryExpression":
      if (expr.left.type === "PrivateName") {
        return estimateSideEffect(expr.right);
      } else {
        return estimateSideEffect(expr.left) || estimateSideEffect(expr.right);
      }
    case "SequenceExpression":
      return expr.expressions.some(elem => estimateSideEffect(elem));
    case "ArrayExpression":
      return expr.elements.some(elem => elem == null ? false : elem.type === "SpreadElement" ? estimateSideEffect(elem.argument) : estimateSideEffect(elem));
    case "ObjectExpression":
      return expr.properties.some(elem => elem.type === "SpreadElement" ? estimateSideEffect(elem.argument) : elem.type === "ObjectMethod" ? estimateSideEffect(elem.key) : elem.key.type === "PrivateName" ? estimateSideEffect(elem.value) : estimateSideEffect(elem.key) && estimateSideEffect(elem.value));
  }
  return true;
}