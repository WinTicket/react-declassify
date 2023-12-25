import { getOr, isClassMethodLike, nonNullPath } from "../utils.js";
import { AnalysisError } from "./error.js";
import { analyzeLibRef, isReactRef } from "./lib.js";
import { addClassFieldError } from "./class_fields.js";
const SPECIAL_MEMBER_NAMES = new Set([
// Special variables
"context", "props", "refs", "state",
// Lifecycle
"constructor", "render", "componentDidCatch", "componentDidMount", "componentDidUpdate", "componentWillMount", "UNSAFE_componentWillMount", "componentWillReceiveProps", "UNSAFE_componentWillReceiveProps", "componentWillUpdate", "UNSAFE_componentWillUpdate", "componentWillUnmount",
// Lifecycle predicates
"shouldComponentUpdate", "getSnapshotBeforeUpdate", "getChildContext",
// APIs (including deprecated)
"isReactComponent", "isMounted", "forceUpdate", "setState", "replaceState"]);
export function analyzeUserDefined(instanceFields, softErrors) {
  const fields = new Map();
  for (const [name, field] of instanceFields) {
    if (SPECIAL_MEMBER_NAMES.has(name)) {
      for (const site of field.sites) {
        addClassFieldError(site, softErrors);
      }
      continue;
    }
    let fnInit = undefined;
    let isRefInit = false;
    let refInitType1 = undefined;
    let refInitType2 = undefined;
    let valInit = undefined;
    let valInitType = undefined;
    const initSite = field.sites.find(site => site.init);
    if (initSite) {
      const init = initSite.init;
      if (isClassMethodLike(initSite.path)) {
        fnInit = {
          type: "method",
          path: initSite.path
        };
      } else if (init.type === "init_value") {
        const initPath = init.valuePath;
        if (initPath.isFunctionExpression() || initPath.isArrowFunctionExpression()) {
          fnInit = {
            type: "func_def",
            initPath
          };
        }
        if (initPath.isCallExpression()) {
          const initFn = initPath.get("callee");
          const initArgs = initPath.get("arguments");
          const initRef = analyzeLibRef(initFn);
          if (initRef && isReactRef(initRef) && initRef.name === "createRef") {
            if (initArgs.length > 0) {
              throw new AnalysisError("Extra arguments to createRef");
            }
            isRefInit = true;
            const typeParameters = nonNullPath(initPath.get("typeParameters"));
            if (typeParameters) {
              const params = typeParameters.get("params");
              if (params.length > 0) {
                // this.foo = React.createRef<HTMLDivElement>();
                //                            ^^^^^^^^^^^^^^
                refInitType1 = params[0];
              }
            }
          }
        }
        valInit = initPath;
      }
    }
    const typeSite = field.sites.find(site => site.typing);
    if (typeSite) {
      const typing = typeSite.typing;
      if (typing.type === "type_value") {
        if (typing.valueTypePath.isTSTypeReference()) {
          const lastName = typing.valueTypePath.node.typeName.type === "Identifier" ? typing.valueTypePath.node.typeName.name : typing.valueTypePath.node.typeName.right.name;
          const typeParameters = nonNullPath(typing.valueTypePath.get("typeParameters"));
          if (lastName === "RefObject" && typeParameters) {
            const params = typeParameters.get("params");
            if (params.length > 0) {
              // class C {
              //   foo: React.RefObject<HTMLDivElement>;
              //                        ^^^^^^^^^^^^^^
              // }
              refInitType2 = params[0];
            }
          }
        }
        // class C {
        //   foo: HTMLDivElement | null;
        //        ^^^^^^^^^^^^^^^^^^^^^
        // }
        valInitType = typing.valueTypePath;
      }
    }
    const hasWrite = field.sites.some(site => site.hasWrite);
    if (fnInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_function",
        init: fnInit,
        typeAnnotation: valInitType,
        sites: field.sites,
        // set to true in the later analysis
        needMemo: false,
        dependencies: []
      });
    } else if (isRefInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_ref",
        typeAnnotation: refInitType1 ?? refInitType2,
        sites: field.sites
      });
    } else {
      fields.set(name, {
        type: "user_defined_direct_ref",
        init: valInit,
        typeAnnotation: valInitType,
        sites: field.sites
      });
    }
  }

  // Analysis for `useCallback` inference
  // preDependencies: dependency between methods
  const preDependencies = new Map();
  // It's actually a stack but either is fine
  const queue = [];
  // First loop: analyze preDependencies and memo requirement
  for (const [name, field] of instanceFields) {
    const ud = fields.get(name);
    if (ud?.type !== "user_defined_function") {
      continue;
    }
    for (const site of field.sites) {
      if (site.type === "expr" && site.owner != null) {
        const ownerField = fields.get(site.owner);
        if (ownerField?.type === "user_defined_function") {
          getOr(preDependencies, site.owner, () => []).push(name);
        }
      }
      if (site.type === "expr") {
        const path1 = site.path.parentPath;
        // If it is directly called, memoization is not necessary for this expression.
        if (!path1.isCallExpression()) {
          if (!ud.needMemo) {
            queue.push(name);
            ud.needMemo = true;
          }
        }
      }
    }
  }
  // Do a search (BFS or DFS) to expand needMemo frontier
  while (queue.length > 0) {
    const name = queue.pop();
    for (const depName of preDependencies.get(name) ?? []) {
      const depUD = fields.get(depName);
      if (depUD.type === "user_defined_function" && !depUD.needMemo) {
        queue.push(depName);
        depUD.needMemo = true;
      }
    }
  }
  // Teorder fields in the order of dependency
  // while keepping the original order otherwise.
  // This is done with a typical topological sort
  const reorderedFields = new Map();
  const reorderVisited = new Set();
  function addReorderedField(name) {
    if (reorderedFields.has(name)) {
      return;
    }
    if (reorderVisited.has(name)) {
      throw new AnalysisError("Recursive dependency in memoized methods");
    }
    reorderVisited.add(name);
    const ud = fields.get(name);
    if (ud?.type === "user_defined_function" && ud.needMemo) {
      for (const depName of preDependencies.get(name) ?? []) {
        if (fields.get(depName)?.type === "user_defined_function") {
          addReorderedField(depName);
        }
      }
    }
    reorderedFields.set(name, fields.get(name));
  }
  for (const [name] of fields) {
    addReorderedField(name);
  }
  return {
    fields: reorderedFields
  };
}
export function postAnalyzeCallbackDependencies(userDefined, props, states, instanceFields) {
  for (const [name, prop] of props.props) {
    for (const alias of prop.aliases) {
      if (alias.owner == null) {
        continue;
      }
      const ownerField = userDefined.fields.get(alias.owner);
      if (ownerField?.type !== "user_defined_function") {
        continue;
      }
      ownerField.dependencies.push({
        type: "dep_prop_alias",
        name
      });
    }
    for (const site of prop.sites) {
      if (site.owner == null) {
        continue;
      }
      const ownerField = userDefined.fields.get(site.owner);
      if (ownerField?.type !== "user_defined_function") {
        continue;
      }
      if (site.path.parentPath.isCallExpression()) {
        // Special case for `this.props.onClick()`:
        // Always try to decompose it to avoid false eslint-plugin-react-hooks exhaustive-deps warning.
        site.enabled = true;
      }
      if (site.enabled) {
        ownerField.dependencies.push({
          type: "dep_prop_alias",
          name
        });
      } else {
        ownerField.dependencies.push({
          type: "dep_prop",
          name
        });
      }
    }
  }
  for (const site of props.sites) {
    if (site.owner == null || site.child || site.decomposedAsAliases) {
      continue;
    }
    const ownerField = userDefined.fields.get(site.owner);
    if (ownerField?.type !== "user_defined_function") {
      continue;
    }
    ownerField.dependencies.push({
      type: "dep_props_obj"
    });
  }
  for (const [name, state] of states.states) {
    for (const site of state.sites) {
      if (site.type !== "expr") {
        continue;
      }
      if (site.owner == null) {
        continue;
      }
      const ownerField = userDefined.fields.get(site.owner);
      if (ownerField?.type !== "user_defined_function") {
        continue;
      }
      ownerField.dependencies.push({
        type: "dep_state",
        name
      });
    }
  }
  for (const [name, field] of instanceFields) {
    const ud = userDefined.fields.get(name);
    if (ud?.type !== "user_defined_function") {
      continue;
    }
    for (const site of field.sites) {
      if (site.type === "expr" && site.owner != null) {
        const ownerField = userDefined.fields.get(site.owner);
        if (ownerField?.type === "user_defined_function") {
          ownerField.dependencies.push({
            type: "dep_function",
            name
          });
        }
      }
    }
  }
}