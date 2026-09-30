import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

// Deliberately pinned migration audit, not a substitute for future feature tests.
const root = resolve(import.meta.dir, "..");
const base = "c569473";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const original = (path: string) => git("show", base + ":" + path);
const current = (path: string) => readFileSync(resolve(root, path), "utf8");
const entries = git("ls-tree", "-r", base)
  .trim()
  .split("\n")
  .map((line) => {
    const [meta, path] = line.split("\t");
    return { path, hash: meta.split(" ")[2] };
  });
const relocated: Record<string, string> = {
  "docker-compose.yml": "compose.yaml",
  "frontend/src/index.css": "frontend/src/styles.css",
};
const consolidated = new Set([
  "frontend/README.md",
  "frontend/src/components/CameraFeed.tsx",
  "frontend/src/components/CompactChart.tsx",
  "frontend/src/components/DashboardCard.tsx",
  "frontend/src/components/EmptyTelemetryState.tsx",
  "frontend/src/components/GaugePointer.tsx",
  "frontend/src/components/Header.tsx",
  "frontend/src/components/MapComponent.tsx",
  "frontend/src/components/MetricPanel.tsx",
  "frontend/src/components/RunControlButtons.tsx",
  "frontend/src/components/SignalTile.tsx",
  "frontend/src/layouts/InteractiveGrid.tsx",
  "frontend/src/pages/Data.tsx",
  "frontend/src/pages/Replay.tsx",
  "frontend/src/utils/Socket.ts",
  "frontend/src/utils/data.ts",
  "frontend/src/utils/locations.ts",
  "frontend/src/utils/telemetry.ts",
  "frontend/src/utils/ws.ts",
]);
const excludedFiles = new Set(["frontend/src/components/SideBar.tsx"]);
const edited = new Set([
  "README.md",
  ".gitignore",
  "frontend/src/App.tsx",
  "frontend/src/main.tsx",
]);
const added = new Set([
  "compose.yaml",
  "frontend/src/Controls.tsx",
  "frontend/src/Diagnostics.tsx",
  "frontend/src/data.ts",
  "frontend/src/types.ts",
  "frontend/src/styles.css",
  "frontend/src/panels/Autonomy.tsx",
  "frontend/src/panels/Localization.tsx",
  "frontend/src/panels/Perception.tsx",
  "frontend/src/panels/Planning.tsx",
  "tests/frontend.test.ts",
  "tests/migration.test.ts",
]);
function files(path: string): string[] {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? files(path + "/" + entry.name)
        : [path + "/" + entry.name],
  );
}
function definitions(source: string) {
  const sf = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const definitions = new Map<string, ts.Node>();
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        definitions.set(declaration.name.getText(sf), declaration);
    } else if ("name" in statement && statement.name) {
      definitions.set((statement.name as ts.Node).getText(sf), statement);
    }
  }
  return { sf, definitions };
}
function tokens(source: string) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  const result = [];
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    result.push(
      token === ts.SyntaxKind.NumericLiteral
        ? String(Number(scanner.getTokenText().replaceAll("_", "")))
        : scanner.getTokenText(),
    );
  }
  // Formatting may add trailing commas; preserve array elisions and literal text.
  return JSON.stringify(
    result.filter(
      (value, index) =>
        !(
          value === "," &&
          result[index - 1] !== "," &&
          ["}", "]", ")"].includes(result[index + 1])
        ),
    ),
  );
}
function canonical(node: ts.Node, sf: ts.SourceFile) {
  let text = ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, node, sf)
    .replace(/^export (default )?/, "");
  if (ts.isVariableDeclaration(node)) text = "const " + text + ";";
  if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
    return tokens(text);
  return tokens(
    ts.transpileModule(text, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        removeComments: true,
      },
    }).outputText,
  );
}
const knownChanged: Record<string, string[]> = {
  "frontend/src/App.tsx": ["App", "AppPage"],
  "frontend/src/components/Header.tsx": ["Header"],
  "frontend/src/components/SideBar.tsx": ["SideBar", "SideBarTile"],
  "frontend/src/layouts/InteractiveGrid.tsx": [
    "InteractiveGrid",
    "RunSummaryState",
  ],
  "frontend/src/pages/Data.tsx": ["Data"],
  "frontend/src/pages/Replay.tsx": [
    "Replay",
    "PLAYBACK_SPEEDS",
    "BASE_PLAYBACK_INTERVAL_MS",
    "RosbagReplayResponse",
    "parseReplayRosbag",
  ],
  "frontend/src/utils/telemetry.ts": ["calculateLapTimes"],
};

describe("complete migration accounting against " + base, () => {
  test("every baseline file is unchanged, exactly moved, consolidated, or explicitly excluded", () => {
    for (const { path, hash } of entries) {
      if (edited.has(path)) continue;
      if (consolidated.has(path) || excludedFiles.has(path)) {
        expect(existsSync(resolve(root, path)), path).toBe(false);
        continue;
      }
      const destination = relocated[path] ?? path;
      const content = readFileSync(resolve(root, destination));
      const actual = createHash("sha1")
        .update("blob " + content.length + "\0")
        .update(content)
        .digest("hex");
      expect(actual, destination).toBe(hash);
    }
    const baseline = new Set(entries.map((e) => e.path));
    const all = [
      ...git("ls-files").trim().split("\n"),
      ...git("ls-files", "--others", "--exclude-standard").trim().split("\n"),
    ].filter(Boolean);
    for (const path of all)
      if (!baseline.has(path))
        expect(added.has(path), "Unaccounted new file: " + path).toBe(true);
  });

  test("all retained top-level declarations match, including import helpers formerly in Replay", () => {
    const destinations = files("frontend/src")
      .concat(["tests/frontend.test.ts"])
      .filter((p) => /\.tsx?$/.test(p))
      .map((path) =>
        definitions(
          current(path)
            .replace(/<GoogleMap(?=[\s>])/g, "<Map")
            .replace(/<\/GoogleMap>/g, "</Map>"),
        ),
      );
    for (const { path } of entries.filter(
      (e) => e.path.startsWith("frontend/src/") && /\.tsx?$/.test(e.path),
    )) {
      const before = definitions(original(path));
      for (const [name, node] of before.definitions) {
        if (knownChanged[path]?.includes(name)) continue;
        const expected = canonical(node, before.sf);
        const candidates = destinations.filter((d) => d.definitions.has(name));
        expect(
          candidates.some(
            (d) => canonical(d.definitions.get(name)!, d.sf) === expected,
          ),
          path + " :: " + name,
        ).toBe(true);
      }
    }
    const before = definitions(
      original("frontend/src/layouts/InteractiveGrid.tsx").replace(
        "  lapTimes: number[];\n",
        "",
      ),
    );
    const after = definitions(current("frontend/src/panels/Autonomy.tsx"));
    expect(canonical(after.definitions.get("RunSummaryState")!, after.sf)).toBe(
      canonical(before.definitions.get("RunSummaryState")!, before.sf),
    );
  });

  test("branding, scroll styles, body title and documentation credits/media are retained", () => {
    expect(current("frontend/index.html")).toBe(
      original("frontend/index.html"),
    );
    expect(current("frontend/src/styles.css")).toBe(
      original("frontend/src/index.css"),
    );
    expect(current("README.md").split("## Summary")[0]).toBe(
      original("README.md").split("## Summary")[0],
    );
    for (const asset of ["LiveRED.mp4", "ReplayRED.mp4"])
      expect(current("README.md")).toContain(
        'src="frontend/public/' + asset + '"',
      );
    expect(current("frontend/src/App.tsx")).toContain(
      'alt="Race Engineer Dashboard"',
    );
    expect(current("frontend/src/App.tsx")).toContain(
      'className="w-8 h-8 sm:w-10 sm:h-10"',
    );
    expect(current("frontend/src/panels/Autonomy.tsx")).not.toContain(
      "<details",
    );
    expect(current("frontend/src/data.ts")).not.toContain("/replay/rosbag");
    expect(current("frontend/src/main.tsx")).toBe(
      original("frontend/src/main.tsx").replace("./index.css", "./styles.css"),
    );
    expect(current(".gitignore")).toBe(
      original(".gitignore").replace(
        "frontend/node_modules/\n",
        "frontend/node_modules/\nfrontend/dist/\n",
      ),
    );
  });

  test("every original live-grid local and effect is retained except explicit replay/lap pieces", () => {
    function locals(source: string, name: string) {
      const parsed = definitions(source);
      const fn = parsed.definitions.get(name) as ts.FunctionDeclaration;
      const result = new Map<string, string>();
      for (const statement of fn.body!.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations)
            result.set(
              declaration.name.getText(parsed.sf),
              canonical(declaration, parsed.sf),
            );
        }
      }
      const effects = fn.body!.statements.filter(
        (s) =>
          ts.isExpressionStatement(s) &&
          s.expression.getText(parsed.sf).startsWith("useEffect("),
      );
      return { result, effects: effects.map((e) => canonical(e, parsed.sf)) };
    }
    const baseline = locals(
      original("frontend/src/layouts/InteractiveGrid.tsx").replaceAll(
        "    lapTimes: [],\n",
        "",
      ),
      "InteractiveGrid",
    );
    const targets = [
      locals(current("frontend/src/App.tsx"), "App"),
      locals(current("frontend/src/panels/Autonomy.tsx"), "Autonomy"),
      locals(current("frontend/src/panels/Localization.tsx"), "Localization"),
    ];
    const removed = new Set([
      "lapTimerTimestamp",
      "toggleReplayRunTracking",
      "handleLap",
      "canStartRunTracking",
    ]);
    for (const [name, value] of baseline.result) {
      if (removed.has(name)) continue;
      expect(
        targets.some((t) => t.result.get(name) === value),
        "Unaccounted grid local: " + name,
      ).toBe(true);
    }
    for (const effect of baseline.effects)
      expect(targets.some((t) => t.effects.includes(effect))).toBe(true);
  });
});

// Evaluate components with lightweight mock hooks/JSX. No DOM, timers, network or vehicle commands.
type Element = { type: any; props: any };
const jsx = (type: any, props: any): Element => ({ type, props });
const symbol = (name: string) => Object.assign(() => {}, { testName: name });
function evaluate(
  source: string,
  requireFn: (path: string) => any,
  extra: Record<string, unknown> = {},
) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  runInNewContext(output, {
    exports,
    require: requireFn,
    Error,
    console: { warn() {}, error() {} },
    ...extra,
  });
  return exports as any;
}
function hooks(initial: any[] = []) {
  const values: any[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  return {
    values,
    effects,
    reset() {
      cursor = 0;
      effects.length = 0;
    },
    react: {
      useState(value: any) {
        const index = cursor++;
        if (!(index in values))
          values[index] =
            index in initial
              ? initial[index]
              : typeof value === "function"
                ? value()
                : value;
        return [
          values[index],
          (next: any) => {
            values[index] =
              typeof next === "function" ? next(values[index]) : next;
          },
        ];
      },
      useMemo(fn: () => any) {
        return fn();
      },
      useEffect(fn: () => void) {
        effects.push(fn);
      },
    },
  };
}
const helpers = evaluate(original("frontend/src/utils/telemetry.ts"), () => {
  throw Error("Unexpected import");
});
function imports(
  state: ReturnType<typeof hooks>,
  overrides: Record<string, any> = {},
) {
  return (path: string) => {
    if (path in overrides) return overrides[path];
    if (path === "react") return state.react;
    if (path === "react/jsx-runtime")
      return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (path === "../data" || path.endsWith("/telemetry")) return helpers;
    return new Proxy(
      { default: symbol(path) },
      {
        get(target, key) {
          return key in target
            ? target[key as keyof typeof target]
            : symbol(String(key));
        },
      },
    );
  };
}
function find(
  node: any,
  predicate: (e: Element) => boolean,
): Element | undefined {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}
function sample(time: number, latitude = 42, current = 10) {
  return {
    seq: time,
    global_ts: time,
    power: { ts: time, current, voltage: 24 },
    steering: { ts: time, brake_pressure: 100, turn_angle: 1 },
    rpm_front: { ts: time, rpm_left: 10, rpm_right: 11 },
    rpm_back: { ts: time, rpm_left: 12, rpm_right: 13 },
    gps: { ts: time, lat: latitude, long: -76, heading: 0, speed: 3 },
    motor: { ts: time, rpm: 10, duty_cycle: 0.2 },
    filtered: { speed: 3 },
    latency_ms: 4,
  };
}
function runTracking(isOld: boolean, paused: boolean) {
  const a = sample(1_000_000),
    b = sample(2_000_000, 42.001, 20);
  const state = hooks(isOld ? [paused, [a]] : []);
  const controls = {
    RosbagControlButton: symbol("bag"),
    AutonomyControlButton: symbol("auto"),
    ToggleControlButton: symbol("toggle"),
  };
  const component = evaluate(
    isOld
      ? original("frontend/src/layouts/InteractiveGrid.tsx")
      : current("frontend/src/panels/Autonomy.tsx"),
    imports(state, { "../components/RunControlButtons": controls }),
  );
  function render(data: any[]) {
    state.reset();
    return component.default({
      data,
      history: paused ? [a] : data,
      children: (views: any) => views.summary,
    });
  }
  function callbacks(tree: any) {
    const control = find(
      tree,
      (n) => n.type?.testName === (isOld ? "bag" : "../Controls"),
    )!;
    return isOld ? control.props : control.props.recording;
  }
  let tree = render([a, b]);
  callbacks(tree).onStart();
  const index = isOld ? 3 : 1;
  const snapshot = () => {
    const result = { ...state.values[index] };
    delete result.lapTimes;
    return result;
  };
  const started = snapshot();
  tree = render([a, b, sample(3_000_000, 42.002, 30)]);
  for (const effect of state.effects) effect();
  const accumulated = snapshot();
  callbacks(tree).onStop();
  return { started, accumulated, stopped: snapshot() };
}
describe("preserved integration behavior", () => {
  test("the seven original live cards keep their order, titles and layout classes", () => {
    const data = [sample(1_000_000)];
    const oldState = hooks();
    const oldGrid = evaluate(
      original("frontend/src/layouts/InteractiveGrid.tsx"),
      imports(oldState),
    );
    const oldTree = oldGrid.default({ data });
    const newState = hooks();
    const app = evaluate(
      current("frontend/src/App.tsx"),
      imports(newState, {
        "./data": { default: { getData: () => data } },
        "./Diagnostics": evaluate(
          current("frontend/src/Diagnostics.tsx"),
          imports(newState),
        ),
        "@mui/material/styles": {
          createTheme: (x: any) => x,
          ThemeProvider: symbol("theme"),
        },
      }),
    );
    const tree = app.default();
    const autonomy = find(
      tree,
      (n) => n.type?.testName === "./panels/Autonomy",
    )!;
    const localization = autonomy.props.children({
      speed: null,
      summary: null,
      signals: null,
    });
    const newTree = localization.props.children({ map: null, chart: null });
    const describeCards = (tree: Element) =>
      tree.props.children
        .filter(Boolean)
        .map((card: Element) => ({
          title: card.props.title,
          className: card.props.className,
        }));
    expect(newTree.props.className).toBe(oldTree.props.className);
    expect(describeCards(newTree)).toEqual(describeCards(oldTree));
  });

  test("latency keeps the original zero/missing/negative-value presentation", () => {
    const diagnostics = evaluate(
      current("frontend/src/Diagnostics.tsx"),
      () => ({}),
    );
    expect(diagnostics.formatLatencySuffix(null)).toBe("");
    expect(diagnostics.formatLatencySuffix({ latency_ms: null })).toBe("");
    expect(diagnostics.formatLatencySuffix({ latency_ms: 0 })).toBe("");
    expect(diagnostics.formatLatencySuffix({ latency_ms: -2.6 })).toBe(
      " | Latency [3ms]",
    );
  });

  test("recording start/accumulation/stop matches before, both live and paused", () => {
    for (const paused of [false, true])
      expect(runTracking(false, paused)).toEqual(runTracking(true, paused));
  });

  test("App passes the same paused history to both domains, while retaining incoming raw samples", () => {
    const data = [sample(1_000_000)];
    let subscribed: () => void = () => {};
    const socket = {
      getData: () => data,
      connect() {},
      subscribe(callback: () => void) {
        subscribed = callback;
        return () => {};
      },
    };
    const state = hooks();
    const app = evaluate(
      current("frontend/src/App.tsx"),
      imports(state, {
        "./data": { default: socket },
        "./Diagnostics": { formatLatencySuffix: () => "" },
        "@mui/material/styles": {
          createTheme: (x: any) => x,
          ThemeProvider: symbol("theme"),
        },
      }),
    );
    function view() {
      state.reset();
      const tree = app.default();
      const autonomy = find(
        tree,
        (n) => n.type?.testName === "./panels/Autonomy",
      )!;
      const localization = autonomy.props.children({
        speed: null,
        summary: null,
        signals: null,
      });
      return { autonomy, localization };
    }
    let result = view();
    for (const effect of state.effects) effect();
    result.localization.props.onTogglePause();
    result = view();
    const pausedHistory = result.autonomy.props.history;
    data.push(sample(2_000_000));
    subscribed();
    result = view();
    expect(result.autonomy.props.history).toBe(pausedHistory);
    expect(result.localization.props.history).toBe(pausedHistory);
    expect(result.autonomy.props.data.length).toBe(2);
    expect(result.autonomy.props.history.length).toBe(1);
    result.localization.props.onTogglePause();
    result = view();
    expect(result.autonomy.props.history.length).toBe(2);
    expect(result.localization.props.history).toBe(
      result.autonomy.props.history,
    );
  });

  test("control guard, pending state, success/error callbacks and start/stop requests are retained", async () => {
    const state = hooks();
    const paths: string[] = [];
    const events: string[] = [];
    let complete: () => void = () => {};
    let rejectRequest: (e: Error) => void = () => {};
    const component = evaluate(
      current("frontend/src/Controls.tsx"),
      imports(state, {
        "./data": {
          postControlRequest(path: string) {
            paths.push(path);
            return new Promise<void>((resolve, reject) => {
              complete = resolve;
              rejectRequest = reject;
            });
          },
        },
      }),
    );
    const props = {
      startPath: "/bag/start",
      stopPath: "/bag/stop",
      startLabel: "Start",
      stopLabel: "Stop",
      failureLabel: "failed",
      onStart: () => events.push("start"),
      onStop: () => events.push("stop"),
      onError: (e: string) => events.push(e),
      canStart: () => false,
    };
    function render() {
      state.reset();
      return component.EndpointStartStopButton(props);
    }
    await render().props.onClick();
    expect(paths).toEqual([]);
    props.canStart = () => true;
    const start = render().props.onClick();
    expect(render().props.isPending).toBe(true);
    await render().props.onClick();
    expect(paths).toEqual(["/bag/start"]);
    complete();
    await start;
    expect(render().props.isRunning).toBe(true);
    expect(events).toEqual(["start"]);
    const failedStop = render().props.onClick();
    rejectRequest(new Error("offline"));
    await failedStop;
    expect(render().props.isRunning).toBe(true);
    expect(render().props.isPending).toBe(false);
    expect(events).toEqual(["start", "offline"]);
    const stop = render().props.onClick();
    complete();
    await stop;
    expect(render().props.isRunning).toBe(false);
    expect(events.at(-1)).toBe("stop");
    expect(paths).toEqual(["/bag/start", "/bag/stop", "/bag/stop"]);
  });
});
