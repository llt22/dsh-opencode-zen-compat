# opencode-zen-compat

DSH(DeepSeek Harness)插件:修复 opencode Zen 网关流式响应的**非标准结束标志**导致的"断响应"问题。

## 特性

- 🎯 精准作用域:只处理 opencode 系 provider 路由(provider id 含 `opencode`,或 `llm-pi-ai` 配置中该路由的 baseURL 含 `opencode.ai`),其他供应商的截断检测行为完全不变
- 🧩 官方扩展点:通过 DSH 的 `llm/stream` waterfall 拦截,不修改任何 node_modules 文件
- 📦 自注册 bundle:package.json 声明 `dsh.bundle.patch`,安装后自动挂载,DSH 升级后不丢失
- 🪶 零依赖:仅使用 DSH 暴露的服务接口(cordis / llm / settings),无第三方依赖

## 一键安装(推荐)

> 不需要克隆仓库、不需要源码目录、不需要自己打包。下面的命令直接从 GitHub Release 下载已打包插件。

```bash
dsh plugin --profile desktop add https://github.com/llt22/dsh-opencode-zen-compat/releases/download/v1.0.0/opencode-zen-compat-1.0.0.tgz
```

安装完成后**重启 DSH Desktop**即可生效。升级时重复执行同一条命令即可。

如果你的 DSH CLI 没有加入 PATH,可以使用 DSH Desktop 自带的 CLI 入口:

```bash
'/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/lib/desktop-cli.js' \
  plugin --profile desktop add https://github.com/llt22/dsh-opencode-zen-compat/releases/download/v1.0.0/opencode-zen-compat-1.0.0.tgz
```

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

## 验证

- 重启后用 opencode 系模型对话,响应不再中断、回合正常结束
- 日志中可见插件命中记录:`opencode-zen-compat: tolerating missing finish_reason for provider "..."`
- 非 opencode 路由(如 zivora)行为不受任何影响

## 卸载

```bash
dsh plugin --profile desktop remove opencode-zen-compat
```

卸载后重启 DSH Desktop。

## 源码开发

普通用户不需要阅读本节。需要修改插件时才需要克隆仓库并重新打包。

```bash
git clone https://github.com/llt22/dsh-opencode-zen-compat.git
cd dsh-opencode-zen-compat
pnpm pack
dsh plugin --profile desktop add ./opencode-zen-compat-1.0.0.tgz
```

目录结构:

```text
dsh-opencode-zen-compat/
├── lib/index.js        # 插件本体(拦截逻辑)
├── cordis.patch.yml    # 自注册 Loader 行
├── test/smoke.mjs      # 无依赖冒烟测试
├── package.json        # dsh.bundle.patch 声明
└── README.md
```

运行测试:

```bash
node test/smoke.mjs
```

## 与手工补丁的关系

此前手工修改 pi-ai node_modules(`requiresFinishReason` 兼容标志)的方案与本插件功能等价、互不冲突;手工补丁会在 DSH 升级时被覆盖,本插件是持久方案。

## 许可证

MIT
