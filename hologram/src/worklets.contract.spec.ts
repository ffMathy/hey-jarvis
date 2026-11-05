import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Every worklet is declared after everything of its module it reads.
 *
 * Reanimated's Babel plugin turns a worklet function into a `const`, made where it stands by a
 * factory that is handed, there and then, every module-level name the worklet uses (its
 * `__closure`). A `const` is not hoisted, so a worklet that uses a function, a worklet or a
 * constant declared further down the module reads it before it is initialised, and the module
 * throws as it loads — "Cannot access 'deadEndSpoke' before initialization" — on a phone or a
 * watch, and nowhere else: under `bun test`, in a browser and on the headset a worklet is an
 * ordinary function declaration, hoisted, and the order never matters
 * (`.claude/rules/hologram-worklets.md`).
 *
 * So the order is checked rather than remembered. Every module of the package that is not a test
 * is parsed with TypeScript's own compiler, and every name each module-level worklet reads is
 * resolved to what it names; one declared at the module's top level below the worklet that reads
 * it fails. A module-level value made by calling a worklet — `const table = worklet()`, or inside a
 * callback its initialiser runs, `[...].map(() => worklet())` — counts too: that call runs before a
 * worklet declared below it exists.
 */

const PACKAGE_SOURCES = import.meta.dir;

/** The package's modules: every `.ts` and `.tsx` under `src/` that is not a test or a test's fake. */
function packageModules(directory = PACKAGE_SOURCES): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : packageModules(path);
    return /\.tsx?$/.test(entry.name) && !/\.(spec|test|fakes)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Whether a function's body opens with the `'worklet'` directive. */
function isWorklet(node: ts.Node): node is ts.FunctionLikeDeclaration {
  if (!(ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return false;
  const body = node.body;
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'worklet'
  );
}

/** A module-level declaration: its name, where it starts, and whether it is a worklet. */
interface TopLevel {
  name: string;
  start: number;
  worklet: boolean;
  /** What runs where it stands: a worklet's body, or the initialiser of anything else. */
  runs: ts.Node | undefined;
}

function topLevelsOf(file: ts.SourceFile): TopLevel[] {
  return file.statements.flatMap((statement): TopLevel[] => {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const worklet = isWorklet(statement);
      return [
        { name: statement.name.text, start: statement.getStart(file), worklet, runs: worklet ? statement : undefined },
      ];
    }
    if (ts.isClassDeclaration(statement) && statement.name)
      return [{ name: statement.name.text, start: statement.getStart(file), worklet: false, runs: undefined }];
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration) => {
      if (!ts.isIdentifier(declaration.name)) return [];
      const initializer = declaration.initializer;
      const worklet = initializer !== undefined && isWorklet(initializer);
      return [{ name: declaration.name.text, start: declaration.getStart(file), worklet, runs: initializer }];
    });
  });
}

/** Whether `node` is inside a type, where a name is never read when the module runs. */
function inAType(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isTypeNode(at) || ts.isTypeAliasDeclaration(at) || ts.isInterfaceDeclaration(at)) return true;
  }
  return false;
}

/**
 * The identifiers `node` reads when it runs, and those of every function inside it: a worklet's
 * inner functions read what it captured, and a callback in a value's initialiser
 * (`[...].map(() => worklet())`, `Array.from({ length }, () => worklet())`) runs as the value is
 * made. A function stored in the value to be called later is read too, which only ever over-reports.
 */
function readsOf(node: ts.Node): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child) && !inAType(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** The module-level declaration an identifier names, if it names one of `file`'s. */
function declarationNamed(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Declaration | undefined {
  const parent = identifier.parent;
  const symbol =
    parent && ts.isShorthandPropertyAssignment(parent)
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(identifier);
  return symbol?.valueDeclaration;
}

/** Each module-level declaration's node, to the top level it declares. */
function topLevelDeclarations(file: ts.SourceFile, tops: TopLevel[]) {
  const declaredAt = new Map<ts.Node, TopLevel>();
  const declared = (node: ts.Node) => {
    const top = tops.find((candidate) => candidate.start === node.getStart(file));
    if (top) declaredAt.set(node, top);
  };
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach(declared);
    else declared(statement);
  }
  return declaredAt;
}

/**
 * Every read, in the modules `sources` holds by name, of a module-level name declared
 * further down its module by a worklet, or of a worklet declared further down by a module-level
 * value as it is made: `<module>: <reader> reads <name>, declared after it`.
 */
function readsBeforeDeclared(sources: Record<string, string>): string[] {
  const host = ts.createCompilerHost({ noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve });
  const files = new Map(
    Object.entries(sources).map(([name, text]) => [
      name,
      ts.createSourceFile(
        name,
        text,
        ts.ScriptTarget.ESNext,
        true,
        name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    ]),
  );
  host.getSourceFile = (name) => files.get(name);
  host.fileExists = (name) => files.has(name);
  const program = ts.createProgram([...files.keys()], { noResolve: true, noLib: true, types: [] }, host);
  const checker = program.getTypeChecker();
  return [...files.entries()].flatMap(([name, file]) => {
    const tops = topLevelsOf(file);
    const declaredAt = topLevelDeclarations(file, tops);
    return tops.flatMap((reader) => {
      if (!reader.runs) return [];
      return readsOf(reader.runs).flatMap((identifier) => {
        const declaration = declarationNamed(checker, identifier);
        const named = declaration && declaredAt.get(declaration);
        if (!named || named === reader || named.start < reader.start) return [];
        // a worklet made later breaks whatever reads it; anything else only a worklet, which is a const
        if (!reader.worklet && !named.worklet) return [];
        return [`${name}: ${reader.name} reads ${named.name}, declared after it`];
      });
    });
  });
}

describe("the package's worklets", () => {
  const modules = packageModules().map((path) => relative(PACKAGE_SOURCES, path));

  it('are checked in every module of the package, the cascades and the picture among them', () => {
    expect(modules).toContain('cage-cascade.ts');
    expect(modules).toContain(join('gpu', 'gpu-picture.ts'));
  });

  // One test a module: a name read is resolved within its own module (`noResolve`), so each is
  // checked alone, and no single test holds a type checker over the whole package, which under a
  // whole workspace's tests at once took over half of bun's five seconds.
  for (const module of modules) {
    it(`are each declared after every worklet, function and constant they read, in ${module}`, () => {
      const source = readFileSync(join(PACKAGE_SOURCES, module), 'utf8');

      expect(readsBeforeDeclared({ [module]: source })).toEqual([]);
    });
  }

  it('tells a worklet reading what is declared above it from one reading what is declared below it', () => {
    const examples: Array<[source: string, found: string[]]> = [
      ["function inner() { 'worklet'; return 1; }\nexport function outer() { 'worklet'; return inner(); }", []],
      [
        "export function outer() { 'worklet'; return inner(); }\nfunction inner() { 'worklet'; return 1; }",
        ['example.ts: outer reads inner, declared after it'],
      ],
      [
        "export function outer() { 'worklet'; return LATER; }\nconst LATER = 2;",
        ['example.ts: outer reads LATER, declared after it'],
      ],
      [
        "export function outer() { 'worklet'; const run = () => inner(); return run(); }\nfunction inner() { 'worklet'; return 1; }",
        ['example.ts: outer reads inner, declared after it'],
      ],
      [
        "export function outer() { 'worklet'; return { inner }; }\nfunction inner() { 'worklet'; return 1; }",
        ['example.ts: outer reads inner, declared after it'],
      ],
      [
        "const table = made();\nfunction made() { 'worklet'; return 1; }",
        ['example.ts: table reads made, declared after it'],
      ],
      // a callback the value's initialiser runs straight away calls it before it exists too
      [
        "const table = [1].map(() => made());\nfunction made() { 'worklet'; return 1; }",
        ['example.ts: table reads made, declared after it'],
      ],
      [
        "const table = Array.from({ length: 2 }, (_, at) => made(at));\nfunction made(at: number) { 'worklet'; return at; }",
        ['example.ts: table reads made, declared after it'],
      ],
      // a plain function is still hoisted, but one a worklet calls cannot run on the UI thread either,
      // so it counts; and a plain function reading a worklet below it runs only once both exist
      [
        "export function outer() { 'worklet'; return helper(); }\nfunction helper() { return 1; }",
        ['example.ts: outer reads helper, declared after it'],
      ],
      ["export function plain() { return later(); }\nfunction later() { 'worklet'; return 1; }", []],
      // a name of its own, a property, a type and a parameter are not the module's
      [
        "export function outer(inner: number) { 'worklet'; const value: Later = { inner }; return value.LATER + inner; }\nfunction inner() { 'worklet'; return 1; }\ntype Later = { LATER: number };\nconst LATER = 2;",
        [],
      ],
    ];
    for (const [source, found] of examples) {
      expect({ source, found: readsBeforeDeclared({ 'example.ts': source }) }).toEqual({ source, found });
    }
  });
});
