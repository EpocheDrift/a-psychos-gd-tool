import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const PACKAGE_SOURCE = new URL(
  '../packages/mcp-companion/src/',
  import.meta.url,
);
const PACKAGE_DIST = new URL(
  '../packages/mcp-companion/dist/',
  import.meta.url,
);
const AGENT_SOURCE = new URL('../src/agent/', import.meta.url);
const MODEL_PREPARATION_SOURCE_PATH = resolve(fileURLToPath(
  new URL('../src/agent/modelPreparation.ts', import.meta.url),
));
const PACKAGE_SOURCE_PATH = resolve(fileURLToPath(PACKAGE_SOURCE));
const PACKAGE_DIST_PATH = resolve(fileURLToPath(PACKAGE_DIST));

const PACKAGE_FILE_NAMES = [
  'agentSecurity',
  'boundedJson',
  'boundedStdio',
  'bridgeClient',
  'browserSession',
  'faults',
  'index',
  'localAppHost',
  'modelCache',
  'modelDownloader',
  'modelManager',
  'modelManifest',
  'modelPublicContract',
  'protocol',
  'runtime',
  'toolSchemas',
  'tools',
];
const PACKAGE_FILE_KEYS = new Map();
for (const name of PACKAGE_FILE_NAMES) {
  PACKAGE_FILE_KEYS.set(
    resolve(fileURLToPath(new URL(`${name}.ts`, PACKAGE_SOURCE))),
    name,
  );
  PACKAGE_FILE_KEYS.set(
    resolve(fileURLToPath(new URL(`${name}.js`, PACKAGE_DIST))),
    name,
  );
}
const PACKAGE_LOCAL_IMPORTS = new Set(
  PACKAGE_FILE_NAMES.map((name) => `./${name}.js`),
);

const PACKAGE_IMPORT_CAPABILITIES = new Map([
  ['boundedStdio', new Map([
    ['node:process', new Set(['default'])],
    ['node:stream', new Set(['Readable', 'Transform', 'Writable'])],
    ['node:util', new Set(['TextDecoder'])],
    [
      '@modelcontextprotocol/sdk/server/stdio.js',
      new Set(['StdioServerTransport']),
    ],
  ])],
  ['bridgeClient', new Map([
    ['node:crypto', new Set(['createHash', 'randomBytes'])],
    ['ws', new Set(['RawData', 'WebSocket'])],
  ])],
  ['browserSession', new Map([
    ['node:fs', new Set(['constants'])],
    ['node:fs/promises', new Set(['access'])],
    ['node:path', new Set(['delimiter', 'join'])],
    ['node:process', new Set(['default'])],
    ['puppeteer-core', new Set(['Browser', 'BrowserContext', 'default'])],
  ])],
  ['index', new Map([
    ['node:process', new Set(['default'])],
  ])],
  ['localAppHost', new Map([
    [
      'node:crypto',
      new Set(['createHash', 'randomBytes', 'timingSafeEqual']),
    ],
    ['node:events', new Set(['once'])],
    ['node:fs/promises', new Set(['readFile', 'readdir'])],
    [
      'node:http',
      new Set(['IncomingMessage', 'ServerResponse', 'createServer']),
    ],
    ['node:path', new Set(['extname', 'relative', 'resolve', 'sep'])],
    ['node:stream', new Set(['Duplex'])],
    ['node:url', new Set(['fileURLToPath'])],
    ['ws', new Set(['WebSocketServer'])],
  ])],
  ['modelCache', new Map([
    ['node:crypto', new Set(['createHash'])],
    ['node:fs', new Set(['constants'])],
    [
      'node:fs/promises',
      new Set([
        'lstat',
        'mkdir',
        'mkdtemp',
        'open',
        'readFile',
        'rename',
        'rm',
      ]),
    ],
    ['node:os', new Set(['homedir'])],
    [
      'node:path',
      new Set(['dirname', 'join', 'parse', 'resolve', 'sep']),
    ],
  ])],
  ['modelDownloader', new Map([
    ['node:http', new Set(['IncomingMessage'])],
    ['node:https', new Set(['RequestOptions', 'request'])],
  ])],
  ['modelManager', new Map([
    ['node:crypto', new Set(['createHash', 'timingSafeEqual'])],
  ])],
  ['toolSchemas', new Map([
    ['zod/v4', new Set(['*'])],
  ])],
  ['tools', new Map([
    ['node:crypto', new Set(['createHash'])],
    [
      '@modelcontextprotocol/sdk/server/mcp.js',
      new Set(['McpServer']),
    ],
    [
      '@modelcontextprotocol/sdk/types.js',
      new Set(['CallToolResult', 'ImageContent']),
    ],
  ])],
]);

const FORBIDDEN_MODULES =
  /^(?:(?:node:)?(?:child_process|vm|inspector)|puppeteer|playwright(?:-core)?|@playwright\/test|selenium-webdriver|webdriverio|chrome-remote-interface)(?:\/|$)/;

const FORBIDDEN_PROPERTIES = new Set([
  '$eval',
  '$$eval',
  'addScriptTag',
  'click',
  'createCDPSession',
  'dispatchEvent',
  'drag',
  'dragAndDrop',
  'evaluate',
  'evaluateHandle',
  'exposeFunction',
  'goBack',
  'goForward',
  'hover',
  'keyboard',
  'keyDown',
  'keyUp',
  'locator',
  'mouse',
  'press',
  'reload',
  'setContent',
  'tap',
  'uploadFile',
  'waitForFunction',
]);
const FORBIDDEN_CALL_PROPERTIES = new Set(['select', 'type']);
const FORBIDDEN_PACKAGE_PROPERTIES = new Set([
  'getBuiltinModule',
  'respond',
  'setRequestInterception',
]);

const BROWSER_HANDLE_METHODS = new Map([
  ['puppeteer', new Set(['launch'])],
  ['browser', new Set(['close', 'createBrowserContext', 'once'])],
  ['context', new Set(['close', 'newPage'])],
  [
    'page',
    new Set(['goto', 'setCookie', 'setDefaultNavigationTimeout']),
  ],
]);
const BROWSER_TRUSTED_BINDINGS = new Set([
  'puppeteer',
  'browser',
  'context',
  'page',
  'AGENT_ALLOWED_ORIGIN',
  'AGENT_COOKIE_NAME',
  'CreatedBrowserSession',
]);
// The gate deliberately uses fixed binding names instead of pretending to be
// a full inter-file type checker. Every declaration of these names is checked
// below, aliases are rejected, and the origin/class bindings cannot be
// reassigned; lexical shadowing therefore fails closed.
const IMMUTABLE_BROWSER_BINDINGS = new Set([
  'AGENT_ALLOWED_ORIGIN',
  'AGENT_COOKIE_NAME',
  'CreatedBrowserSession',
]);

const FORBIDDEN_TEXT = [
  ['CDP session', /\bCDPSession\b|\bRuntime\.evaluate\b/],
  [
    'remote debugging',
    /--remote-debugging|browserWSEndpoint|debuggerAddress|devtools\s*:/,
  ],
  ['user profile attachment', /--user-data-dir|userDataDir\s*:/],
];

function scriptKind(pathname) {
  if (pathname.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (pathname.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function stringLiteralValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return stringLiteralValue(node.argumentExpression);
  }
  return null;
}

function isLocalSpecifier(specifier) {
  return specifier.startsWith('.');
}

function packageRootForPath(pathname) {
  const absolute = resolve(pathname);
  for (const root of [PACKAGE_SOURCE_PATH, PACKAGE_DIST_PATH]) {
    if (absolute.startsWith(`${root}${sep}`)) return root;
  }
  return null;
}

function importedBindings(node) {
  if (!ts.isImportDeclaration(node) || !node.importClause) return [];
  const output = [];
  if (node.importClause.name) output.push('default');
  const bindings = node.importClause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    output.push('*');
  } else if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      output.push((element.propertyName ?? element.name).text);
    }
  }
  return output;
}

function sourceLocation(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function inspectModuleSpecifier(
  violations,
  sourceFile,
  node,
  specifier,
  options,
  packageKey,
) {
  if (FORBIDDEN_MODULES.test(specifier)) {
    violations.push(
      `forbidden module "${specifier}" at ${sourceLocation(sourceFile, node)}`,
    );
    return;
  }
  if (
    specifier === 'puppeteer-core'
    && packageKey !== 'browserSession'
  ) {
    violations.push(
      `Puppeteer outside browserSession at ${sourceLocation(sourceFile, node)}`,
    );
    return;
  }
  if (
    options.packageFile
    && isLocalSpecifier(specifier)
  ) {
    const root = packageRootForPath(sourceFile.fileName);
    const target = resolve(dirname(sourceFile.fileName), specifier);
    if (
      !root
      || !target.startsWith(`${root}${sep}`)
      || !PACKAGE_LOCAL_IMPORTS.has(specifier)
    ) {
      violations.push(
        `local module is outside the scanned package allowlist "${specifier}" at ${
          sourceLocation(sourceFile, node)
        }`,
      );
    }
    return;
  }
  if (
    options.packageFile
    && !isLocalSpecifier(specifier)
  ) {
    const capabilities = packageKey
      ? PACKAGE_IMPORT_CAPABILITIES.get(packageKey)
      : undefined;
    const allowedBindings = capabilities?.get(specifier);
    if (!allowedBindings) {
      violations.push(
        `unreviewed external module "${specifier}" at ${
          sourceLocation(sourceFile, node)
        }`,
      );
      return;
    }
    if (ts.isExportDeclaration(node)) {
      violations.push(
        `external module re-export "${specifier}" at ${
          sourceLocation(sourceFile, node)
        }`,
      );
      return;
    }
    for (const binding of importedBindings(node)) {
      if (!allowedBindings.has(binding)) {
        violations.push(
          `unreviewed "${specifier}" binding "${binding}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
    }
  }
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAwaitExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function browserTypeKind(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return null;
  const name = typeNode.typeName.getText();
  if (name === 'Browser') return 'browser';
  if (name === 'BrowserContext') return 'context';
  if (name === 'Page') return 'page';
  return null;
}

function browserHandleKind(node, handleKinds) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) {
    return handleKinds.get(expression.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && expression.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    if (expression.name.text === 'browser') return 'browser';
    if (expression.name.text === 'context') return 'context';
    if (expression.name.text === 'page') return 'page';
  }
  if (!ts.isCallExpression(expression)) return null;
  const target = expression.expression;
  if (
    !ts.isPropertyAccessExpression(target)
    && !ts.isElementAccessExpression(target)
  ) {
    return null;
  }
  const ownerKind = browserHandleKind(target.expression, handleKinds);
  const method = propertyName(target);
  if (ownerKind === 'puppeteer' && method === 'launch') return 'browser';
  if (ownerKind === 'browser' && method === 'createBrowserContext') {
    return 'context';
  }
  if (ownerKind === 'context' && method === 'newPage') return 'page';
  return null;
}

function collectBrowserHandleKinds(sourceFile) {
  const handleKinds = new Map();
  const nodes = [];
  const collect = (node) => {
    nodes.push(node);
    if (
      ts.isImportDeclaration(node)
      && stringLiteralValue(node.moduleSpecifier) === 'puppeteer-core'
      && node.importClause?.name
    ) {
      handleKinds.set(node.importClause.name.text, 'puppeteer');
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node))
      && ts.isIdentifier(node.name)
    ) {
      const kind =
        browserTypeKind(node.type)
        ?? (
          ['browser', 'context', 'page'].includes(node.name.text)
            ? node.name.text
            : null
        );
      if (kind) handleKinds.set(node.name.text, kind);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      let target;
      let value;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        target = node.name.text;
        value = node.initializer;
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
      ) {
        target = node.left.text;
        value = node.right;
      }
      if (!target || !value || handleKinds.has(target)) continue;
      const kind = browserHandleKind(value, handleKinds);
      if (kind) {
        handleKinds.set(target, kind);
        changed = true;
      }
    }
  }
  return handleKinds;
}

function enclosingNamedFunction(node, name) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current)
      && current.name?.text === name
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function objectLiteralProperties(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const properties = new Map();
  for (const property of node.properties) {
    let name = null;
    let value = null;
    if (ts.isPropertyAssignment(property)) {
      if (ts.isIdentifier(property.name)) name = property.name.text;
      else name = stringLiteralValue(property.name);
      value = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      name = property.name.text;
      value = property.name;
    }
    if (name === null || value === null || properties.has(name)) return null;
    properties.set(name, value);
  }
  return properties;
}

function hasExactPropertyNames(properties, expected) {
  return properties.size === expected.length
    && expected.every((name) => properties.has(name));
}

function isStringProperty(properties, name, expected) {
  const value = properties.get(name);
  return value !== undefined && stringLiteralValue(value) === expected;
}

function hasApprovedPinnedRouteBinding(sourceFile, name) {
  let approved = 0;
  let rejected = false;
  const visit = (node) => {
    if (
      ts.isIdentifier(node)
      && node.text === name
      && isValueBindingIdentifier(node)
    ) {
      const declaration = containingImportDeclaration(node);
      const valid =
        ts.isImportSpecifier(node.parent)
        && node.parent.name === node
        && (node.parent.propertyName ?? node.parent.name).text === name
        && declaration !== null
        && stringLiteralValue(declaration.moduleSpecifier)
          === '../../packages/mcp-companion/src/modelPublicContract';
      if (valid) approved += 1;
      else rejected = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return approved === 1 && !rejected;
}

function isAllowedPinnedModelFetch(sourceFile, node) {
  if (
    resolve(sourceFile.fileName) !== MODEL_PREPARATION_SOURCE_PATH
    || !ts.isCallExpression(node)
    || !ts.isIdentifier(node.expression)
    || node.expression.text !== 'fetch'
    || node.arguments.length !== 2
    || !ts.isIdentifier(node.arguments[0])
  ) {
    return false;
  }
  const route = node.arguments[0].text;
  if (!hasApprovedPinnedRouteBinding(sourceFile, route)) return false;
  const statusRequest =
    route === 'MODEL_STATUS_PATH'
    && enclosingNamedFunction(node, 'getPinnedModelStatus');
  const prepareRequest =
    route === 'MODEL_PREPARE_PATH'
    && enclosingNamedFunction(node, 'preparePinnedModelFromTrustedUi');
  if (!statusRequest && !prepareRequest) return false;

  const properties = objectLiteralProperties(node.arguments[1]);
  const expectedNames = statusRequest
    ? ['method', 'signal', 'credentials', 'cache', 'redirect', 'headers']
    : [
        'method',
        'signal',
        'credentials',
        'cache',
        'redirect',
        'headers',
        'body',
      ];
  if (
    !properties
    || !hasExactPropertyNames(properties, expectedNames)
    || !ts.isIdentifier(properties.get('signal'))
    || properties.get('signal').text !== 'signal'
    || !isStringProperty(
      properties,
      'method',
      statusRequest ? 'GET' : 'POST',
    )
    || !isStringProperty(properties, 'credentials', 'same-origin')
    || !isStringProperty(properties, 'cache', 'no-store')
    || !isStringProperty(properties, 'redirect', 'error')
  ) {
    return false;
  }

  const headers = objectLiteralProperties(properties.get('headers'));
  if (
    !headers
    || !hasExactPropertyNames(
      headers,
      statusRequest ? ['Accept'] : ['Accept', 'Content-Type'],
    )
    || !isStringProperty(headers, 'Accept', 'application/json')
    || (
      prepareRequest
      && !isStringProperty(
        headers,
        'Content-Type',
        'application/json',
      )
    )
  ) {
    return false;
  }
  return statusRequest || ts.isCallExpression(properties.get('body'));
}

function enclosingCreatedSessionConstructor(node) {
  let current = node.parent;
  while (
    current
    && !ts.isConstructorDeclaration(current)
    && !ts.isClassDeclaration(current)
  ) {
    current = current.parent;
  }
  return Boolean(current)
    && ts.isConstructorDeclaration(current)
    && ts.isClassDeclaration(current.parent)
    && current.parent.name?.text === 'CreatedBrowserSession';
}

function containingImportDeclaration(node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return null;
}

function isValueBindingIdentifier(node) {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isFunctionExpression(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isClassExpression(parent) && parent.name === node)
    || (ts.isEnumDeclaration(parent) && parent.name === node)
    || (ts.isModuleDeclaration(parent) && parent.name === node)
    || (ts.isImportEqualsDeclaration(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && parent.name === node)
    || (ts.isNamespaceImport(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
  );
}

function writeTargetIdentifiers(node, output = []) {
  const target = unwrapExpression(node);
  if (ts.isIdentifier(target)) {
    output.push(target);
    return output;
  }
  if (ts.isArrayLiteralExpression(target)) {
    for (const element of target.elements) {
      if (ts.isOmittedExpression(element)) continue;
      writeTargetIdentifiers(
        ts.isSpreadElement(element) ? element.expression : element,
        output,
      );
    }
    return output;
  }
  if (ts.isObjectLiteralExpression(target)) {
    for (const property of target.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        output.push(property.name);
      } else if (ts.isPropertyAssignment(property)) {
        writeTargetIdentifiers(property.initializer, output);
      } else if (ts.isSpreadAssignment(property)) {
        writeTargetIdentifiers(property.expression, output);
      }
    }
    return output;
  }
  if (
    ts.isBinaryExpression(target)
    && target.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    writeTargetIdentifiers(target.left, output);
  }
  // Property/element targets mutate an object, not the lexical binding whose
  // spelling may happen to match a trusted name.
  return output;
}

function isApprovedBrowserBinding(node, handleKinds) {
  const name = node.text;
  const parent = node.parent;
  if (name === 'puppeteer') {
    const declaration = containingImportDeclaration(node);
    return ts.isImportClause(parent)
      && parent.name === node
      && declaration !== null
      && stringLiteralValue(declaration.moduleSpecifier) === 'puppeteer-core';
  }
  if (
    name === 'AGENT_ALLOWED_ORIGIN'
    || name === 'AGENT_COOKIE_NAME'
  ) {
    const declaration = containingImportDeclaration(node);
    return ts.isImportSpecifier(parent)
      && parent.name === node
      && (parent.propertyName ?? parent.name).text === name
      && declaration !== null
      && stringLiteralValue(declaration.moduleSpecifier)
        === './agentSecurity.js';
  }
  if (name === 'CreatedBrowserSession') {
    return ts.isClassDeclaration(parent)
      && parent.name === node
      && parent.parent.kind === ts.SyntaxKind.SourceFile;
  }
  if (name !== 'browser' && name !== 'context' && name !== 'page') {
    return false;
  }
  if (
    ts.isParameter(parent)
    && parent.name === node
    && (name === 'browser' || name === 'context')
  ) {
    return enclosingCreatedSessionConstructor(parent);
  }
  if (
    ts.isVariableDeclaration(parent)
    && parent.name === node
    && enclosingNamedFunction(parent, 'launchCompanionBrowser')
  ) {
    if (
      parent.initializer
      && browserHandleKind(parent.initializer, handleKinds) === name
    ) {
      return true;
    }
    return name === 'context'
      && !parent.initializer
      && (
        !parent.type
        || parent.type.getText().includes('BrowserContext')
      );
  }
  return false;
}

function isAllowedBrowserHandleIdentifierUse(
  node,
  sourceFile,
  handleKinds,
) {
  const kind = handleKinds.get(node.text);
  if (!kind) return true;
  if (node.text !== kind) return false;
  const parent = node.parent;

  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (
      (ts.isPropertyAssignment(parent)
        || ts.isPropertyDeclaration(parent)
        || ts.isMethodDeclaration(parent)
        || ts.isMethodSignature(parent)
        || ts.isPropertySignature(parent))
      && parent.name === node
    )
  ) {
    return true;
  }
  if (
    (ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isImportClause(parent))
    && parent.name === node
  ) {
    return true;
  }
  if (
    (
      ts.isPropertyAccessExpression(parent)
      || ts.isElementAccessExpression(parent)
    )
    && parent.expression === node
  ) {
    return true;
  }
  if (
    ts.isVariableDeclaration(parent)
    && parent.initializer === node
    && ts.isIdentifier(parent.name)
    && handleKinds.get(parent.name.text) === kind
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    if (
      parent.right === node
      && ts.isIdentifier(parent.left)
      && handleKinds.get(parent.left.text) === kind
    ) {
      return true;
    }
    if (
      parent.left === node
      && browserHandleKind(parent.right, handleKinds) === kind
    ) {
      return true;
    }
    if (
      parent.right === node
      && ts.isPropertyAccessExpression(parent.left)
      && parent.left.expression.kind === ts.SyntaxKind.ThisKeyword
      && parent.left.name.text === kind
    ) {
      let ancestor = parent.parent;
      while (
        ancestor
        && !ts.isConstructorDeclaration(ancestor)
        && !ts.isClassDeclaration(ancestor)
      ) {
        ancestor = ancestor.parent;
      }
      if (ancestor && ts.isConstructorDeclaration(ancestor)) {
        const owner = ancestor.parent;
        if (
          ts.isClassDeclaration(owner)
          && owner.name?.text === 'CreatedBrowserSession'
        ) {
          return true;
        }
      }
    }
  }
  if (
    ts.isNewExpression(parent)
    && ts.isIdentifier(parent.expression)
    && parent.expression.text === 'CreatedBrowserSession'
    && parent.arguments?.length === 2
    && parent.arguments.some((argument) => argument === node)
    && browserHandleKind(parent.arguments[0], handleKinds) === 'browser'
    && browserHandleKind(parent.arguments[1], handleKinds) === 'context'
  ) {
    return true;
  }
  // Keep the parameter for diagnostics call sites and future type-aware
  // refinements without accepting arbitrary source text comparisons here.
  void sourceFile;
  return false;
}

function isAllowedBrowserProducerUse(node, kind, handleKinds) {
  let expression = node;
  let parent = expression.parent;
  while (
    parent
    && (
      ts.isAwaitExpression(parent)
      || ts.isParenthesizedExpression(parent)
      || ts.isAsExpression(parent)
      || ts.isTypeAssertionExpression(parent)
      || ts.isNonNullExpression(parent)
    )
    && parent.expression === expression
  ) {
    expression = parent;
    parent = expression.parent;
  }
  if (
    ts.isVariableDeclaration(parent)
    && parent.initializer === expression
    && ts.isIdentifier(parent.name)
    && handleKinds.get(parent.name.text) === kind
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.right === expression
    && ts.isIdentifier(parent.left)
    && handleKinds.get(parent.left.text) === kind
  ) {
    return true;
  }
  if (
    (
      ts.isPropertyAccessExpression(parent)
      || ts.isElementAccessExpression(parent)
    )
    && parent.expression === expression
  ) {
    return true;
  }
  return false;
}

export function authorityViolations(
  text,
  pathname,
  options = {},
) {
  const sourceFile = ts.createSourceFile(
    pathname,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(pathname),
  );
  const violations = [];
  const resolvedPathname = resolve(pathname);
  const packageKey = options.packageFile
    ? PACKAGE_FILE_KEYS.get(resolvedPathname)
    : undefined;
  const browserLauncher = packageKey === 'browserSession';
  const browserHandleKinds = browserLauncher
    ? collectBrowserHandleKinds(sourceFile)
    : new Map();

  for (const [label, pattern] of FORBIDDEN_TEXT) {
    if (pattern.test(text)) violations.push(`${label} in ${pathname}`);
  }

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
    ) {
      const specifier = stringLiteralValue(node.moduleSpecifier);
      if (specifier !== null) {
        inspectModuleSpecifier(
          violations,
          sourceFile,
          node,
          specifier,
          options,
          packageKey,
        );
      }
      if (
        ts.isExportDeclaration(node)
        && specifier === 'puppeteer-core'
      ) {
        violations.push(
          `Puppeteer re-export at ${sourceLocation(sourceFile, node)}`,
        );
      }
      if (
        browserLauncher
        && ts.isImportDeclaration(node)
        && specifier === 'puppeteer-core'
        && node.importClause?.namedBindings
        && ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if ((element.propertyName ?? element.name).text === 'default') {
            violations.push(
              `Puppeteer named-default import at ${
                sourceLocation(sourceFile, element)
              }`,
            );
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const calledProperty = propertyName(node.expression);
      if (
        calledProperty
        && FORBIDDEN_CALL_PROPERTIES.has(calledProperty)
      ) {
        violations.push(
          `browser authority call "${calledProperty}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        violations.push(
          `dynamic import at ${sourceLocation(sourceFile, node)}`,
        );
      }
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'require'
      ) {
        violations.push(
          `CommonJS require at ${sourceLocation(sourceFile, node)}`,
        );
      }
      if (
        ts.isIdentifier(node.expression)
        && (
          node.expression.text === 'eval'
          || node.expression.text === 'Function'
          || (
            node.expression.text === 'fetch'
            && !isAllowedPinnedModelFetch(sourceFile, node)
          )
        )
      ) {
        violations.push(
          `generic ${node.expression.text} call at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
      if (
        ts.isElementAccessExpression(node.expression)
        && /controller/i.test(node.expression.expression.getText(sourceFile))
      ) {
        violations.push(
          `reflective controller dispatch at ${sourceLocation(sourceFile, node)}`,
        );
      }

      if (browserLauncher) {
        const target = unwrapExpression(node.expression);
        if (
          ts.isPropertyAccessExpression(target)
          || ts.isElementAccessExpression(target)
        ) {
          const ownerKind = browserHandleKind(
            target.expression,
            browserHandleKinds,
          );
          if (ownerKind) {
            const method = propertyName(target);
            const allowed = method
              ? BROWSER_HANDLE_METHODS.get(ownerKind)?.has(method)
              : false;
            if (!allowed || ts.isElementAccessExpression(target)) {
              violations.push(
                `browser handle "${ownerKind}" call "${
                  method ?? '<computed>'
                }" at ${sourceLocation(sourceFile, node)}`,
              );
            }
            if (
              ownerKind === 'page'
              && method === 'goto'
              && !(
                node.arguments.length >= 1
                && ts.isIdentifier(node.arguments[0])
                && node.arguments[0].text === 'AGENT_ALLOWED_ORIGIN'
              )
            ) {
              violations.push(
                `browser navigation at ${sourceLocation(sourceFile, node)}`,
              );
            }
            if (
              ownerKind === 'browser'
              && method === 'once'
              && stringLiteralValue(node.arguments[0]) !== 'disconnected'
            ) {
              violations.push(
                `unreviewed browser event at ${sourceLocation(sourceFile, node)}`,
              );
            }
          }
        }
        const directBrowserCall =
          (
            ts.isPropertyAccessExpression(target)
            || ts.isElementAccessExpression(target)
          )
          && browserHandleKind(
            target.expression,
            browserHandleKinds,
          ) !== null;
        if (!directBrowserCall) {
          for (const argument of node.arguments) {
            if (browserHandleKind(argument, browserHandleKinds)) {
              violations.push(
                `browser handle escaped into an arbitrary call at ${
                  sourceLocation(sourceFile, argument)
                }`,
              );
            }
          }
        }
        const producedKind = browserHandleKind(node, browserHandleKinds);
        if (
          producedKind
          && !isAllowedBrowserProducerUse(
            node,
            producedKind,
            browserHandleKinds,
          )
        ) {
          violations.push(
            `browser handle producer "${producedKind}" escaped at ${
              sourceLocation(sourceFile, node)
            }`,
          );
        }
      }
    }

    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && (
        node.expression.text === 'Function'
        || node.expression.text === 'XMLHttpRequest'
      )
    ) {
      violations.push(
        `generic ${node.expression.text} construction at ${
          sourceLocation(sourceFile, node)
        }`,
      );
    }

    if (
      ts.isPropertyAccessExpression(node)
      || ts.isElementAccessExpression(node)
    ) {
      const name = propertyName(node);
      if (name && FORBIDDEN_PROPERTIES.has(name)) {
        violations.push(
          `browser authority property "${name}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
      if (
        options.packageFile
        && name
        && FORBIDDEN_PACKAGE_PROPERTIES.has(name)
      ) {
        violations.push(
          `forbidden package authority property "${name}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
      if (browserLauncher) {
        const ownerKind = browserHandleKind(
          node.expression,
          browserHandleKinds,
        );
        if (ownerKind) {
          const allowed = name
            ? BROWSER_HANDLE_METHODS.get(ownerKind)?.has(name)
            : false;
          const directCall =
            ts.isCallExpression(node.parent)
            && node.parent.expression === node;
          if (
            !allowed
            || ts.isElementAccessExpression(node)
            || !directCall
          ) {
            violations.push(
              `browser handle "${ownerKind}" property "${
                name ?? '<computed>'
              }" at ${sourceLocation(sourceFile, node)}`,
            );
          }
        }
      }
      if (name === 'goto') {
        const call = node.parent;
        const allowed =
          browserLauncher
          && ts.isCallExpression(call)
          && call.expression === node
          && call.arguments.length >= 1
          && ts.isIdentifier(call.arguments[0])
          && call.arguments[0].text === 'AGENT_ALLOWED_ORIGIN';
        if (!allowed) {
          violations.push(
            `browser navigation at ${sourceLocation(sourceFile, node)}`,
          );
        }
      }
    }

    if (ts.isBindingElement(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : null;
      const importedName = node.propertyName && ts.isIdentifier(node.propertyName)
        ? node.propertyName.text
        : name;
      if (importedName && FORBIDDEN_PROPERTIES.has(importedName)) {
        violations.push(
          `destructured browser authority "${importedName}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
      if (
        options.packageFile
        && importedName
        && FORBIDDEN_PACKAGE_PROPERTIES.has(importedName)
      ) {
        violations.push(
          `destructured package authority "${importedName}" at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
    }

    if (
      browserLauncher
      && ts.isIdentifier(node)
      && browserHandleKinds.has(node.text)
      && !isAllowedBrowserHandleIdentifierUse(
        node,
        sourceFile,
        browserHandleKinds,
      )
    ) {
      violations.push(
        `browser handle "${node.text}" escaped its allowlisted use sites at ${
          sourceLocation(sourceFile, node)
        }`,
      );
    }

    if (
      browserLauncher
      && ts.isIdentifier(node)
      && BROWSER_TRUSTED_BINDINGS.has(node.text)
      && isValueBindingIdentifier(node)
      && !isApprovedBrowserBinding(node, browserHandleKinds)
    ) {
      violations.push(
        `browser trusted binding "${node.text}" was shadowed at ${
          sourceLocation(sourceFile, node)
        }`,
      );
    }

    if (
      browserLauncher
      && ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      for (const identifier of writeTargetIdentifiers(node.left)) {
        if (IMMUTABLE_BROWSER_BINDINGS.has(identifier.text)) {
          violations.push(
            `browser trusted binding "${identifier.text}" was reassigned at ${
              sourceLocation(sourceFile, identifier)
            }`,
          );
        }
      }
    }

    if (
      browserLauncher
      && (ts.isForInStatement(node) || ts.isForOfStatement(node))
      && !ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const identifier of writeTargetIdentifiers(node.initializer)) {
        if (IMMUTABLE_BROWSER_BINDINGS.has(identifier.text)) {
          violations.push(
            `browser trusted binding "${identifier.text}" was loop-assigned at ${
              sourceLocation(sourceFile, identifier)
            }`,
          );
        }
      }
    }

    if (
      browserLauncher
      && (
        ts.isPrefixUnaryExpression(node)
        || ts.isPostfixUnaryExpression(node)
      )
      && (
        node.operator === ts.SyntaxKind.PlusPlusToken
        || node.operator === ts.SyntaxKind.MinusMinusToken
      )
      && ts.isIdentifier(node.operand)
      && IMMUTABLE_BROWSER_BINDINGS.has(node.operand.text)
    ) {
      violations.push(
        `browser trusted binding "${node.operand.text}" was mutated at ${
          sourceLocation(sourceFile, node)
        }`,
      );
    }

    if (
      browserLauncher
      && (
        ts.isPropertyAccessExpression(node)
        || ts.isElementAccessExpression(node)
      )
      && node.expression.kind === ts.SyntaxKind.ThisKeyword
      && (
        ts.isElementAccessExpression(node)
        || ['browser', 'context', 'page'].includes(node.name.text)
      )
    ) {
      const parent = node.parent;
      const usedAsReceiver =
        (
          ts.isPropertyAccessExpression(parent)
          || ts.isElementAccessExpression(parent)
        )
        && parent.expression === node;
      let approvedConstructorAssignment = false;
      if (
        ts.isPropertyAccessExpression(node)
        && ts.isBinaryExpression(parent)
        && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && parent.left === node
      ) {
        let ancestor = parent.parent;
        while (
          ancestor
          && !ts.isConstructorDeclaration(ancestor)
          && !ts.isClassDeclaration(ancestor)
        ) {
          ancestor = ancestor.parent;
        }
        approvedConstructorAssignment =
          Boolean(ancestor)
          && ts.isConstructorDeclaration(ancestor)
          && ts.isClassDeclaration(ancestor.parent)
          && ancestor.parent.name?.text === 'CreatedBrowserSession'
          && browserHandleKind(parent.right, browserHandleKinds)
            === node.name.text;
      }
      if (
        ts.isElementAccessExpression(node)
        || (!usedAsReceiver && !approvedConstructorAssignment)
      ) {
        violations.push(
          `browser session field escaped its allowlisted use sites at ${
            sourceLocation(sourceFile, node)
          }`,
        );
      }
    }

    if (
      browserLauncher
      && node.kind === ts.SyntaxKind.ThisKeyword
      && !(
        (
          ts.isPropertyAccessExpression(node.parent)
          || ts.isElementAccessExpression(node.parent)
        )
        && node.parent.expression === node
      )
    ) {
      violations.push(
        `browser session "this" escaped at ${sourceLocation(sourceFile, node)}`,
      );
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

async function collectFiles() {
  const files = [];
  const visit = async (url, kind) => {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      if (kind === 'dist' && entry.name === 'app') continue;
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) {
        await visit(child, kind);
        continue;
      }
      const productionTypeScript =
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        && !entry.name.includes('.test.');
      const compiledJavaScript =
        kind === 'dist' && entry.name.endsWith('.js');
      if (productionTypeScript || compiledJavaScript) {
        const pathname = fileURLToPath(child);
        files.push({
          url: child,
          pathname,
          packageFile: kind === 'package' || kind === 'dist',
        });
      }
    }
  };
  await visit(PACKAGE_SOURCE, 'package');
  await visit(AGENT_SOURCE, 'agent');
  try {
    await visit(PACKAGE_DIST, 'dist');
  } catch (error) {
    if (
      !error
      || typeof error !== 'object'
      || !('code' in error)
      || error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  return files;
}

function runNegativeFixtures() {
  const browserSessionPath = fileURLToPath(
    new URL('browserSession.ts', PACKAGE_SOURCE),
  );
  const fixtures = [
    ['dynamic Puppeteer import', "await import('puppeteer-core')"],
    ['Puppeteer re-export', "export * from 'puppeteer-core'"],
    ['browser tap', 'await page.tap("#approve")'],
    ['browser type', 'await page.type("#scope", "edit")'],
    ['computed evaluation', 'await page["evaluate"](() => 1)'],
    ['destructured click', 'const { click } = page; click()'],
    ['arbitrary navigation', 'await page.goto(userUrl)'],
    ['reflective dispatch', 'controller[method](input)'],
    ['child process', "import { spawn } from 'node:child_process'"],
    ['arbitrary fetch', 'await fetch(userUrl)'],
    [
      'computed browser evaluation',
      "const m = 'evaluate'; const page = await context.newPage(); page[m](() => 1)",
      browserSessionPath,
    ],
    [
      'aliased browser input',
      'const page = await context.newPage(); const f = page.type; f("#x", "secret")',
      browserSessionPath,
    ],
    [
      'builtin module escape',
      "process.getBuiltinModule('node:child_process').spawn('sh')",
      browserSessionPath,
    ],
    [
      'request interception',
      'const page = await context.newPage(); await page.setRequestInterception(true); request.respond({ body: "x" })',
      browserSessionPath,
    ],
    [
      'Puppeteer attachment',
      "import puppeteer from 'puppeteer-core'; await puppeteer.connect({ browserURL: userUrl })",
      browserSessionPath,
    ],
    [
      'arbitrary outbound HTTP',
      "import { request } from 'node:http'; request(userUrl)",
      fileURLToPath(new URL('localAppHost.ts', PACKAGE_SOURCE)),
    ],
    [
      'nested launcher filename',
      "import puppeteer from 'puppeteer-core'; await puppeteer.launch({ pipe: true })",
      fileURLToPath(new URL('evil/browserSession.ts', PACKAGE_SOURCE)),
    ],
    [
      'browser handle object escape',
      "const page = await context.newPage(); const box = { value: page }; const m = 'evaluate'; box.value[m](() => 1)",
      browserSessionPath,
    ],
    [
      'browser handle return escape',
      'const page = await context.newPage(); function leak() { return page; }',
      browserSessionPath,
    ],
    [
      'browser handle property escape',
      'const page = await context.newPage(); globalThis.leaked = page',
      browserSessionPath,
    ],
    [
      'browser handle constructor escape',
      'const page = await context.newPage(); new Evil(page)',
      browserSessionPath,
    ],
    [
      'browser session field return',
      'class CreatedBrowserSession { constructor(browser) { this.browser = browser } leak() { return this.browser } }',
      browserSessionPath,
    ],
    [
      'browser session this alias',
      'class CreatedBrowserSession { constructor(browser) { this.browser = browser } leak() { const self = this; return self.browser } }',
      browserSessionPath,
    ],
    [
      'Puppeteer named-default alias',
      "import { default as driver } from 'puppeteer-core'; await driver.connect({ browserURL: userUrl })",
      browserSessionPath,
    ],
    [
      'array-wrapped page producer',
      'const browser = await puppeteer.launch({ pipe: true }); const context = await browser.createBrowserContext(); const [p] = [await context.newPage()]; await p.content()',
      browserSessionPath,
    ],
    [
      'comma-wrapped page producer',
      'const browser = await puppeteer.launch({ pipe: true }); const context = await browser.createBrowserContext(); const p = (0, await context.newPage()); await p.content()',
      browserSessionPath,
    ],
    [
      'conditional page producer',
      'const browser = await puppeteer.launch({ pipe: true }); const context = await browser.createBrowserContext(); const p = ok ? await context.newPage() : await context.newPage(); await p.content()',
      browserSessionPath,
    ],
    [
      'local import root escape',
      "import value from '../../../outside-companion.js'; void value",
      browserSessionPath,
    ],
    [
      'absolute local import',
      "import value from '/tmp/outside-companion.js'; void value",
      browserSessionPath,
    ],
    [
      'allowed-origin shadow',
      'async function navigate(AGENT_ALLOWED_ORIGIN) { const page = await context.newPage(); await page.goto(AGENT_ALLOWED_ORIGIN) }',
      browserSessionPath,
    ],
    [
      'session-constructor shadow',
      'function wrap(CreatedBrowserSession) { return new CreatedBrowserSession(browser, context) }',
      browserSessionPath,
    ],
    [
      'browser handle shadow',
      'const browser = await puppeteer.launch({ pipe: true }); function close(browser) { return browser.close() }',
      browserSessionPath,
    ],
    [
      'browser handle alias',
      'const page = await context.newPage(); const p = page; await p.content()',
      browserSessionPath,
    ],
    [
      'unscanned local extension',
      "import value from './unscanned.txt'; void value",
      browserSessionPath,
    ],
    [
      'skipped packaged app import',
      "import value from './app/hidden.js'; void value",
      fileURLToPath(new URL('browserSession.js', PACKAGE_DIST)),
    ],
    [
      'named function-expression shadow',
      'const value = function AGENT_ALLOWED_ORIGIN() {}; void value',
      browserSessionPath,
    ],
    [
      'named class-expression shadow',
      'const value = class CreatedBrowserSession {}; void value',
      browserSessionPath,
    ],
    [
      'destructuring trusted rebind',
      '({ value: CreatedBrowserSession } = source)',
      browserSessionPath,
    ],
    [
      'loop trusted rebind',
      'for (CreatedBrowserSession of source) {}',
      browserSessionPath,
    ],
  ];
  for (const [label, source, pathname] of fixtures) {
    const violations = authorityViolations(
      source,
      pathname ?? `/negative/${label.replaceAll(' ', '-')}.ts`,
      { packageFile: true },
    );
    if (violations.length === 0) {
      throw new Error(`Authority gate negative fixture escaped: ${label}.`);
    }
  }

  const allowedLauncher = [
    "import puppeteer from 'puppeteer-core';",
    "import { AGENT_ALLOWED_ORIGIN, AGENT_COOKIE_NAME } from './agentSecurity.js';",
    'class CreatedBrowserSession {}',
    'async function launchCompanionBrowser() {',
    '  const browser = await puppeteer.launch({ pipe: true });',
    '  const context = await browser.createBrowserContext();',
    '  const page = await context.newPage();',
    '  await page.setCookie({ name: AGENT_COOKIE_NAME, url: AGENT_ALLOWED_ORIGIN });',
    '  page.setDefaultNavigationTimeout(20_000);',
    '  await page.goto(AGENT_ALLOWED_ORIGIN, { waitUntil: "domcontentloaded" });',
    "  browser.once('disconnected', onDisconnected);",
    '  return new CreatedBrowserSession(browser, context);',
    '}',
  ].join('\n');
  const launcherViolations = authorityViolations(
    allowedLauncher,
    browserSessionPath,
    { packageFile: true },
  );
  if (launcherViolations.length > 0) {
    throw new Error(
      `Authority gate rejected its narrow launcher fixture: ${
        launcherViolations.join(' | ')
      }`,
    );
  }
}

export async function checkMcpAuthority() {
  runNegativeFixtures();
  const failures = [];
  for (const file of await collectFiles()) {
    const text = await readFile(file.url, 'utf8');
    failures.push(...authorityViolations(text, file.pathname, file));
  }
  if (failures.length > 0) {
    throw new Error(
      `Companion authority gate failed:\n${failures.join('\n')}`,
    );
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  await checkMcpAuthority();
  process.stdout.write(
    'MCP authority gate passed (AST policy + negative fixtures).\n',
  );
}
