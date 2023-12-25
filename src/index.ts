import type {
  ArrowFunctionExpression,
  ClassMethod,
  ClassPrivateMethod,
  Comment,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  Node,
  ObjectMethod,
  Pattern,
  RestElement,
  Statement,
  TSEntityName,
  TSType,
  TSTypeAnnotation,
  TSTypeParameterDeclaration,
  VariableDeclaration,
} from "@babel/types";
import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import {
  assignReturnType,
  assignTypeAnnotation,
  assignTypeArguments,
  assignTypeParameters,
  importName,
  isClassMethodLike,
  isClassPropertyLike,
  isTS,
  memberFromDecl,
  nonNullPath,
} from "./utils.js";
import {
  AnalysisError,
  analyzeClass,
  preanalyzeClass,
  AnalysisResult,
  needsProps,
  LibRef,
  needAlias,
  SetStateFieldSite,
  SoftErrorRepository,
} from "./analysis.js";

// eslint-disable-next-line @typescript-eslint/ban-types
type Options = {};

export default function plugin(
  babel: typeof import("@babel/core")
): PluginObj<PluginPass & { opts: Options }> {
  const { types: t } = babel;
  return {
    name: "react-declassify",
    visitor: {
      ClassDeclaration(path, state) {
        const ts = isTS(state);
        const preanalysis = preanalyzeClass(path);
        if (!preanalysis) {
          return;
        }
        const softErrors = new SoftErrorRepository();
        if (path.parentPath.isExportDefaultDeclaration()) {
          const declPath = path.parentPath;
          try {
            const analysis = analyzeClass(path, preanalysis, softErrors);
            const { funcNode, typeNode } = transformClass(
              analysis,
              softErrors,
              { ts },
              babel
            );
            if (path.node.id) {
              // Necessary to avoid false error regarding duplicate declaration.
              path.scope.removeBinding(path.node.id.name);
              declPath.replaceWithMultiple([
                constDeclaration(
                  babel,
                  t.cloneNode(path.node.id),
                  funcNode,
                  typeNode ? t.tsTypeAnnotation(typeNode) : undefined
                ),
                t.exportDefaultDeclaration(t.cloneNode(path.node.id)),
              ]);
            } else {
              path.replaceWith(funcNode);
            }
          } catch (e) {
            if (!(e instanceof AnalysisError)) {
              throw e;
            }
            t.addComment(
              declPath.node,
              "leading",
              ` react-declassify-disable Cannot perform transformation: ${e.message} `
            );
            refreshComments(declPath.node);
          }
        } else {
          try {
            const analysis = analyzeClass(path, preanalysis, softErrors);
            const { funcNode, typeNode } = transformClass(
              analysis,
              softErrors,
              { ts },
              babel
            );
            // Necessary to avoid false error regarding duplicate declaration.
            path.scope.removeBinding(path.node.id.name);
            path.replaceWith(
              constDeclaration(
                babel,
                t.cloneNode(path.node.id),
                funcNode,
                typeNode ? t.tsTypeAnnotation(typeNode) : undefined
              )
            );
          } catch (e) {
            if (!(e instanceof AnalysisError)) {
              throw e;
            }
            t.addComment(
              path.node,
              "leading",
              ` react-declassify-disable Cannot perform transformation: ${e.message} `
            );
            refreshComments(path.node);
          }
        }
      },
    },
  };
}

type TransformResult = {
  funcNode: Expression;
  typeNode?: TSType | undefined;
};

function transformClass(
  analysis: AnalysisResult,
  softErrors: SoftErrorRepository,
  options: { ts: boolean },
  babel: typeof import("@babel/core")
): TransformResult {
  const { types: t } = babel;
  const { ts } = options;

  for (const [, prop] of analysis.props.props) {
    for (const alias of prop.aliases) {
      if (alias.localName !== prop.newAliasName!) {
        // Rename variables that props are bound to.
        // E.g. `foo` as in `const { foo } = this.props`.
        // This is to ensure we hoist them correctly.
        alias.scope.rename(alias.localName, prop.newAliasName);
      }
    }
  }
  for (const path of analysis.locals.removePaths) {
    path.remove();
  }
  for (const ren of analysis.render.renames) {
    // Rename local variables in the render method
    // to avoid unintentional variable capturing.
    ren.scope.rename(ren.oldName, ren.newName);
  }
  for (const [, prop] of analysis.props.props) {
    for (const site of prop.sites) {
      if (site.enabled) {
        // this.props.foo -> foo
        site.path.replaceWith(t.identifier(prop.newAliasName!));
      }
    }
  }
  for (const site of analysis.props.sites) {
    if (!site.child?.enabled) {
      // this.props -> props
      site.path.replaceWith(site.path.node.property);
    }
  }
  for (const [, prop] of analysis.props.props) {
    if (prop.defaultValue && prop.typing) {
      // Make the prop optional
      prop.typing.node.optional = true;
      if (prop.typing.isTSPropertySignature()) {
        const typeAnnotation = nonNullPath(
          prop.typing.get("typeAnnotation")
        )?.get("typeAnnotation");
        if (typeAnnotation) {
          if (typeAnnotation.isTSUnionType()) {
            if (
              typeAnnotation.node.types.some(
                (t) => t.type === "TSUndefinedKeyword"
              )
            ) {
              // No need to add undefined
            } else {
              typeAnnotation.node.types.push(t.tsUndefinedKeyword());
            }
          } else {
            typeAnnotation.replaceWith(
              t.tsUnionType([typeAnnotation.node, t.tsUndefinedKeyword()])
            );
          }
        }
      }
    }
  }
  for (const [, stateAnalysis] of analysis.state.states) {
    for (const site of stateAnalysis.sites) {
      if (site.type === "expr") {
        // this.state.foo -> foo
        site.path.replaceWith(t.identifier(stateAnalysis.localName!));
      }
    }
  }
  for (const site of analysis.state.setStateSites) {
    function setter(field: SetStateFieldSite) {
      // this.setState({ foo: 1 }) -> setFoo(1)
      return t.callExpression(
        t.identifier(analysis.state.states.get(field.name)!.localSetterName!),
        [field.valuePath.node]
      );
    }
    if (site.fields.length === 1) {
      const field = site.fields[0]!;
      site.path.replaceWith(setter(field));
    } else if (site.path.parentPath.isExpressionStatement()) {
      site.path.parentPath.replaceWithMultiple(
        site.fields.map((field) => t.expressionStatement(setter(field)))
      );
    } else if (site.fields.length === 0) {
      site.path.replaceWith(t.nullLiteral());
    } else {
      site.path.replaceWith(t.sequenceExpression(site.fields.map(setter)));
    }
  }
  for (const [, field] of analysis.userDefined.fields) {
    if (
      field.type === "user_defined_function" ||
      field.type === "user_defined_ref"
    ) {
      for (const site of field.sites) {
        if (site.type === "expr") {
          // this.foo -> foo
          site.path.replaceWith(t.identifier(field.localName!));
        }
      }
    } else if (field.type === "user_defined_direct_ref") {
      for (const site of field.sites) {
        if (site.type === "expr") {
          // this.foo -> foo.current
          site.path.replaceWith(
            t.memberExpression(
              t.identifier(field.localName!),
              t.identifier("current")
            )
          );
        }
      }
    }
  }
  for (const bindThisSite of analysis.bindThisSites) {
    if (bindThisSite.bindsMore) {
      bindThisSite.thisArgPath.replaceWith(t.nullLiteral());
    } else {
      bindThisSite.binderPath.replaceWith(bindThisSite.bindeePath.node);
    }
  }

  // Soft error handling
  for (const softError of softErrors.errors) {
    if (softError.type === "invalid_this") {
      // this -> TODO_this
      softError.path.replaceWith(t.identifier("TODO_this"));
    }
  }

  // Preamble is a set of statements to be added before the original render body.
  const preamble: Statement[] = [];
  const propsWithAlias = Array.from(analysis.props.props).filter(([, prop]) =>
    needAlias(prop)
  );
  if (propsWithAlias.length > 0) {
    // Expand this.props into variables.
    // E.g. const { foo, bar } = props;
    preamble.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.objectPattern(
            propsWithAlias.map(([name, prop]) =>
              t.objectProperty(
                t.identifier(name),
                prop.defaultValue
                  ? t.assignmentPattern(
                      t.identifier(prop.newAliasName!),
                      prop.defaultValue.node
                    )
                  : t.identifier(prop.newAliasName!),
                false,
                name === prop.newAliasName!
              )
            )
          ),
          t.identifier("props")
        ),
      ])
    );
  }
  for (const field of analysis.state.states.values()) {
    // State declarations
    const call = t.callExpression(
      getReactImport("useState", babel, analysis.superClassRef),
      field.init ? [field.init.valuePath.node] : []
    );
    preamble.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.arrayPattern([
            t.identifier(field.localName!),
            t.identifier(field.localSetterName!),
          ]),
          ts && field.typeAnnotation
            ? assignTypeArguments(
                call,
                t.tsTypeParameterInstantiation([
                  field.typeAnnotation.type === "method"
                    ? t.tsFunctionType(
                        undefined,
                        field.typeAnnotation.params.map((p) => p.node),
                        t.tsTypeAnnotation(field.typeAnnotation.returnType.node)
                      )
                    : field.typeAnnotation.path.node,
                ])
              )
            : call
        ),
      ])
    );
  }
  for (const [, field] of analysis.userDefined.fields) {
    if (field.type === "user_defined_function") {
      // Method definitions.
      let init: Expression =
        field.init.type === "method"
          ? functionExpressionFrom(
              babel,
              field.init.path.node,
              t.identifier(field.localName!)
            )
          : field.init.initPath.node;
      if (field.needMemo) {
        const depVars = new Set<string>();
        const depProps = new Set<string>();
        for (const dep of field.dependencies) {
          switch (dep.type) {
            case "dep_props_obj":
              depVars.add("props");
              break;
            case "dep_prop":
              depProps.add(dep.name);
              break;
            case "dep_prop_alias": {
              const prop = analysis.props.props.get(dep.name)!;
              depVars.add(prop.newAliasName!);
              break;
            }
            case "dep_state": {
              const state = analysis.state.states.get(dep.name)!;
              depVars.add(state.localName!);
              break;
            }
            case "dep_function": {
              const field = analysis.userDefined.fields.get(dep.name)!;
              depVars.add(field.localName!);
              break;
            }
          }
        }
        init = t.callExpression(
          getReactImport("useCallback", babel, analysis.superClassRef),
          [
            init,
            t.arrayExpression([
              ...Array.from(depVars)
                .sort()
                .map((name) => t.identifier(name)),
              ...Array.from(depProps)
                .sort()
                .map((name) =>
                  t.memberExpression(t.identifier("props"), t.identifier(name))
                ),
            ]),
          ]
        );
      }
      preamble.push(
        constDeclaration(
          babel,
          t.identifier(field.localName!),
          init,
          field.typeAnnotation
            ? t.tsTypeAnnotation(field.typeAnnotation.node)
            : undefined
        )
      );
    } else if (field.type === "user_defined_ref") {
      // const foo = useRef(null);
      const call = t.callExpression(
        getReactImport("useRef", babel, analysis.superClassRef),
        [t.nullLiteral()]
      );
      preamble.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(field.localName!),
            ts && field.typeAnnotation
              ? assignTypeArguments(
                  call,
                  t.tsTypeParameterInstantiation([field.typeAnnotation.node])
                )
              : call
          ),
        ])
      );
    } else if (field.type === "user_defined_direct_ref") {
      // const foo = useRef(init);
      const call = t.callExpression(
        getReactImport("useRef", babel, analysis.superClassRef),
        [field.init ? field.init.node : t.identifier("undefined")]
      );
      preamble.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(field.localName!),
            ts && field.typeAnnotation
              ? assignTypeArguments(
                  call,
                  t.tsTypeParameterInstantiation([field.typeAnnotation.node])
                )
              : call
          ),
        ])
      );
    }
  }

  if (
    analysis.effects.cdmPath ||
    analysis.effects.cduPath ||
    analysis.effects.cwuPath
  ) {
    // Emit "raw effects"

    // Emit `const isMounted = useRef(false);`
    preamble.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.identifier(analysis.effects.isMountedLocalName!),
          t.callExpression(
            getReactImport("useRef", babel, analysis.superClassRef),
            [t.booleanLiteral(false)]
          )
        ),
      ])
    );

    // Emit first `useEffect` for componentDidMount/componentDidUpdate
    // It also updates `isMounted` -- needed for componentWillUnmount as well!
    preamble.push(
      t.addComment(
        t.expressionStatement(
          t.callExpression(
            getReactImport("useEffect", babel, analysis.superClassRef),
            [
              t.arrowFunctionExpression(
                [],
                t.blockStatement([
                  t.ifStatement(
                    // Condition: `!isMountedLocalName.current`
                    t.unaryExpression(
                      "!",
                      t.memberExpression(
                        t.identifier(analysis.effects.isMountedLocalName!),
                        t.identifier("current")
                      )
                    ),
                    // Consequent: `{ isMountedLocalName.current = true; ... }`
                    t.blockStatement([
                      t.expressionStatement(
                        t.assignmentExpression(
                          "=",
                          t.memberExpression(
                            t.identifier(analysis.effects.isMountedLocalName!),
                            t.identifier("current")
                          ),
                          t.booleanLiteral(true)
                        )
                      ),
                      ...(analysis.effects.cdmPath?.node.body.body ?? []),
                    ]),
                    // Alternate: contents of componentDidUpdate, if any
                    analysis.effects.cduPath?.node.body
                  ),
                ])
              ),
            ]
          )
        ),
        "leading",
        " TODO(react-declassify): refactor this effect (automatically generated from lifecycle)",
        true
      )
    );
    refreshComments(preamble[preamble.length - 1]!);

    if (analysis.effects.cwuPath) {
      // To workaround dependency issues, store the latest callback in a ref

      // Emit `const cleanup = useRef(null);`
      preamble.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(analysis.effects.cleanupLocalName!),
            assignTypeArguments(
              t.callExpression(
                getReactImport("useRef", babel, analysis.superClassRef),
                [t.nullLiteral()]
              ),
              // Type annotation: useRef<(() => void) | null>
              ts
                ? t.tsTypeParameterInstantiation([
                    t.tsUnionType([
                      t.tsFunctionType(
                        null,
                        [],
                        t.tsTypeAnnotation(t.tsVoidKeyword())
                      ),
                      t.tsNullKeyword(),
                    ]),
                  ])
                : null
            )
          ),
        ])
      );

      // Emit `cleanup.current = () => { ... }`
      preamble.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(
              t.identifier(analysis.effects.cleanupLocalName!),
              t.identifier("current")
            ),
            t.arrowFunctionExpression([], analysis.effects.cwuPath.node.body)
          )
        )
      );

      // Emit the second `useEffect` -- this time with empty dependency array
      preamble.push(
        t.addComment(
          t.expressionStatement(
            t.callExpression(
              getReactImport("useEffect", babel, analysis.superClassRef),
              [
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement([
                    // Immediately return the cleanup function
                    t.returnStatement(
                      t.arrowFunctionExpression(
                        [],
                        t.blockStatement([
                          // Check isMounted
                          t.ifStatement(
                            // `if (isMounted.current)`
                            t.memberExpression(
                              t.identifier(
                                analysis.effects.isMountedLocalName!
                              ),
                              t.identifier("current")
                            ),
                            t.blockStatement([
                              // `isMounted.current = false;`
                              t.expressionStatement(
                                t.assignmentExpression(
                                  "=",
                                  t.memberExpression(
                                    t.identifier(
                                      analysis.effects.isMountedLocalName!
                                    ),
                                    t.identifier("current")
                                  ),
                                  t.booleanLiteral(false)
                                )
                              ),
                              // `cleanup.current?.()`
                              t.expressionStatement(
                                t.optionalCallExpression(
                                  t.memberExpression(
                                    t.identifier(
                                      analysis.effects.cleanupLocalName!
                                    ),
                                    t.identifier("current")
                                  ),
                                  [],
                                  true
                                )
                              ),
                            ])
                          ),
                        ])
                      )
                    ),
                  ])
                ),
                t.arrayExpression([]),
              ]
            )
          ),
          "leading",
          " TODO(react-declassify): refactor this effect (automatically generated from lifecycle)",
          true
        )
      );
      refreshComments(preamble[preamble.length - 1]!);
    }
  }

  // Soft error handling
  for (const softError of softErrors.errors) {
    if (softError.type === "invalid_decl") {
      if (isClassPropertyLike(softError.path) && softError.path.node.value) {
        preamble.push(
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              memberFromDecl(
                babel,
                t.identifier("TODO_this"),
                softError.path.node
              ),
              softError.path.node.value
            )
          )
        );
      } else if (isClassMethodLike(softError.path)) {
        preamble.push(
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              memberFromDecl(
                babel,
                t.identifier("TODO_this"),
                softError.path.node
              ),
              functionExpressionFrom(babel, softError.path.node)
            )
          )
        );
      }
    }
  }

  const bodyNode = analysis.render.path.node.body;
  bodyNode.body.splice(0, 0, ...preamble);
  // recast is not smart enough to correctly pretty-print type parameters for arrow functions.
  // so we fall back to functions when type parameters are present.
  const functionNeeded = !!analysis.typeParameters;
  const params = needsProps(analysis)
    ? [
        assignTypeAnnotation(
          t.identifier("props"),
          // If the function is generic, put type annotations here instead of the `const` to be defined.
          // TODO: take children into account, while being careful about difference between `@types/react` v17 and v18
          analysis.typeParameters
            ? analysis.propsTyping
              ? t.tsTypeAnnotation(analysis.propsTyping.node)
              : undefined
            : undefined
        ),
      ]
    : [];
  // If the function is generic, put type annotations here instead of the `const` to be defined.
  const returnType = analysis.typeParameters
    ? // Construct `React.ReactElement | null`
      t.tsTypeAnnotation(
        t.tsUnionType([
          t.tsTypeReference(
            toTSEntity(
              getReactImport("ReactElement", babel, analysis.superClassRef),
              babel
            )
          ),
          t.tsNullKeyword(),
        ])
      )
    : undefined;
  const funcNode: Expression = assignTypeParameters(
    assignReturnType(
      functionNeeded
        ? t.functionExpression(
            analysis.name ? t.cloneNode(analysis.name) : undefined,
            params,
            bodyNode
          )
        : t.arrowFunctionExpression(params, bodyNode),
      returnType
    ),
    analysis.typeParameters?.node
  );
  return {
    funcNode,
    typeNode:
      ts && !analysis.typeParameters
        ? t.tsTypeReference(
            toTSEntity(
              getReactImport("FC", babel, analysis.superClassRef),
              babel
            ),
            analysis.propsTyping
              ? t.tsTypeParameterInstantiation([analysis.propsTyping.node])
              : null
          )
        : undefined,
  };
}

function toTSEntity(
  expr: Expression,
  babel: typeof import("@babel/core")
): TSEntityName {
  const { types: t } = babel;
  if (
    expr.type === "MemberExpression" &&
    !expr.computed &&
    expr.property.type === "Identifier"
  ) {
    return t.tsQualifiedName(
      toTSEntity(expr.object, babel),
      t.cloneNode(expr.property)
    );
  } else if (expr.type === "Identifier") {
    return t.cloneNode(expr);
  }
  throw new Error(`Cannot convert to TSEntityName: ${expr.type}`);
}

function getReactImport(
  name: string,
  babel: typeof import("@babel/core"),
  superClassRef: LibRef
): MemberExpression | Identifier {
  const { types: t } = babel;
  if (superClassRef.type === "global") {
    return t.memberExpression(
      t.identifier(superClassRef.globalName),
      t.identifier(name)
    );
  }

  // NOTE: FCの時は React.FC, それ以外の useState などに関しては named import したい
  if (name === "FC") {
    if (superClassRef.kind === "ns") {
      return t.memberExpression(
        t.identifier(superClassRef.specPath.node.local.name),
        t.identifier(name)
      );
    }
  }

  const decl = superClassRef.specPath.parentPath as NodePath<ImportDeclaration>;
  for (const spec of decl.get("specifiers")) {
    if (spec.isImportSpecifier() && importName(spec.node.imported) === name) {
      return t.cloneNode(spec.node.local);
    }
  }

  // No existing decl
  const newName = decl.scope.getBinding(name)
    ? decl.scope.generateUid(name)
    : name;
  const local = t.identifier(newName);
  decl
    .get("specifiers")
    [decl.node.specifiers.length - 1]!.insertAfter(
      t.importSpecifier(local, name === newName ? local : t.identifier(newName))
    );
  return t.identifier(newName);
}

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression
  | ClassMethod
  | ClassPrivateMethod
  | ObjectMethod;

function functionName(node: FunctionLike): Identifier | undefined {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
      return node.id ?? undefined;
  }
}

function functionDeclarationFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike,
  name?: Identifier | null
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.functionDeclaration(
        name ?? functionName(node),
        node.params as (Identifier | RestElement | Pattern)[],
        node.body.type === "BlockStatement"
          ? node.body
          : t.blockStatement([t.returnStatement(node.body)]),
        node.generator,
        node.async
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

function functionExpressionFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike,
  name?: Identifier | null
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.functionExpression(
        name ?? functionName(node),
        node.params as (Identifier | RestElement | Pattern)[],
        node.body.type === "BlockStatement"
          ? node.body
          : t.blockStatement([t.returnStatement(node.body)]),
        node.generator,
        node.async
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function arrowFunctionExpressionFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.arrowFunctionExpression(
        node.params as (Identifier | RestElement | Pattern)[],
        node.body,
        node.async
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

function constDeclaration(
  babel: typeof import("@babel/core"),
  id: Identifier,
  init: Expression,
  typeAnnotation?: TSTypeAnnotation
): VariableDeclaration | FunctionDeclaration {
  const { types: t } = babel;
  if (
    init.type === "FunctionExpression" &&
    (!init.id || init.id.name === id.name) &&
    !typeAnnotation
  ) {
    return functionDeclarationFrom(babel, init, id);
  }
  return t.variableDeclaration("const", [
    t.variableDeclarator(assignTypeAnnotation(id, typeAnnotation), init),
  ]);
}

/**
 * Refreshes recast's internal state to force generically printing comments.
 */
function refreshComments(node: Node): void;
function refreshComments(node: Node) {
  type ExtNode = Node & {
    comments: Comment[];
    original?: Node | undefined;
  };
  type ExtComment = Comment & {
    leading?: boolean | undefined;
    trailing?: boolean | undefined;
  };
  for (const comment of (node.leadingComments ?? []) as ExtComment[]) {
    comment.leading ??= true;
    comment.trailing ??= false;
  }
  for (const comment of (node.trailingComments ?? []) as ExtComment[]) {
    comment.leading ??= false;
    comment.trailing ??= true;
  }
  (node as ExtNode).comments = [
    ...(node.leadingComments ?? []),
    ...(node.innerComments ?? []),
    ...(node.trailingComments ?? []),
  ];
  (node as ExtNode).original = undefined;
}
