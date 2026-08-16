# opencode-zen-compat

DSH(DeepSeek Harness)插件:修复 opencode Zen 网关流式响应的**非标准结束标志**导致的"断响应"问题。

## 特性

- 🎯 精准作用域:只处理 opencode 系 provider 路由(provider id 含 `opencode`,或 `llm-pi-ai` 配置中该路由的 baseURL 含 `opencode.ai`),其他供应商的截断检测行为完全不变
- 🧩 官方扩展点:通过 DSH 的 `llm/stream` waterfall 拦截,不修改任何 node_modules 文件
- 📦 自注册 bundle:package.json 声明 `dsh.bundle.patch`,`dsh plugin add` 一步完成安装与挂载,DSH 升级后不丢失
- 🪶 零依赖:仅使用 DSH 暴露的服务接口(cordis / llm / settings),无第三方依赖

## 背景

### 问题现象

在 DSH 中通过 opencode Zen 网关(`https://opencode.ai/zen/go/v1`)调用模型(如 gpt-5.6-luna)时,响应文字已经完整流出,但回合在结尾被判定为失败,表现为"断响应"。

### 根因

opencode Zen 的 chat completions 流式响应不符合 OpenAI SSE 规范:

- 内容块只带 `"finish_reason":null`,**永不发送真正的 `finish_reason`**
- 流结尾**不发送 `data: [DONE]` 哨兵**,而是直接以 `data: {"choices":[],"cost":"0"}` 关闭连接

DSH 底层 LLM 库 pi-ai 的 openai-completions 适配器在流结束后发现从未收到 `finish_reason`,会抛出 `Stream ended without finish_reason`,把整轮完整响应标记为错误。

## 工作原理

```text
模型请求 → llm/stream waterfall → [本插件拦截] → pi-ai 适配器 → 原始 chunk 流
                                    │
                                    └─ 流以 error finish (Stream ended without finish_reason) 结束时,
                                       仅对 opencode 系路由改写成正常的 stop finish
```

改写只影响**终端的 finish chunk**:已流出的文本增量、usage 统计全部原样保留,组装出的助手消息与正常完成完全一致。

判定条件(满足其一即命中):

1. provider 路由 id 包含 `opencode`(覆盖 `opencode` / `opencode-go` / `opencode-go-ext` 及未来命名)
2. `ctx.settings.get("llm-pi-ai")` 中该路由的 `baseURL` 包含 `opencode.ai`(覆盖自定义路由名)

## 安装

```bash
# 1. 在插件源码目录打包
cd /Volumes/wd-512/WebstormProjects/dsh-opencode-zen-compat
pnpm pack        # 生成 opencode-zen-compat-1.0.0.tgz

# 2. 安装进 desktop profile(会自动注册到 dsh.profile.bundles,无需手改配置)
dsh plugin --profile desktop add ./opencode-zen-compat-1.0.0.tgz

# 本机没有 dsh 命令时,用 DSH 自带的 CLI 入口(等价):
# '/Users/leemac/Library/Application Support/DSH Desktop/runtime-commands/private/node-bin/node' \
#   '/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/lib/desktop-cli.js' plugin add ./opencode-zen-compat-1.0.0.tgz

# 3. 重启 DSH Desktop(插件随 profile 加载)
```

> 说明:依赖以 `file:` 形式指向打包产物 tgz,请保留该文件(重新 `pnpm install` 时需要)。

## 验证

- 重启后用 opencode 系模型对话,响应不再中断、回合正常结束
- 日志中可见插件命中记录:`opencode-zen-compat: tolerating missing finish_reason for provider "..."`
- 非 opencode 路由(如 zivora)行为不受任何影响

## 卸载

```bash
dsh plugin --profile desktop remove opencode-zen-compat
```

## 开发

```text
dsh-opencode-zen-compat/
├── lib/index.js        # 插件本体(拦截逻辑)
├── cordis.patch.yml    # 自注册 Loader 行
├── test/smoke.mjs      # 无依赖冒烟测试(node 直接运行)
├── package.json        # dsh.bundle.patch 声明
└── README.md
```

```bash
# 运行冒烟测试(不需要 DSH 环境)
node test/smoke.mjs

# 修改代码后更新已安装的插件
pnpm pack && dsh plugin --profile desktop add ./opencode-zen-compat-1.0.0.tgz
```

## 与手工补丁的关系

此前手工修改 pi-ai node_modules(`requiresFinishReason` 兼容标志)的方案与本插件功能等价、互不冲突;手工补丁会在 DSH 升级时被覆盖,本插件是持久方案。

## 许可证

MIT
