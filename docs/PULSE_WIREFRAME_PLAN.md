# Nebula 脉冲线框实施计划

## 基线与不可破坏项

- 唯一源码基线：`/Users/wjl/music-player-app`
- 桌面已安装旧版的等价快照：commit `01963db`
- 功能分支：`codex/old-version-wireframe`
- 原版 Planet 的 detail-2 几何、颜色、节奏逻辑和稳定态三次绘制保持不变。
- 不增加第二个 renderer、`requestAnimationFrame`、`AudioContext` 或 `AnalyserNode`。
- 旧桌面 App 在构建与验收通过前不覆盖；安装时必须先留下可恢复副本。

## 第一性原则

1. 音频只有一个真源：现有 `<audio>` 元素。
2. 分析只有一条链路：现有 Web Audio analyser；线框只读取其频率数据。
3. 每个显示帧只有一个所有者：现有 Three.js 动画循环。
4. 视觉模式是状态，不是独立应用：Planet、Pulse Wire、Liquid Aura 由同一个 `state.visualMode` 管理。
5. 动效使用真实时间：攻击、释放和模式切换均基于秒，不绑定 60fps。
6. 可逆优先：旧版 commit、旧 App 和新构建物都分别保留。

## 实现阶段

### 1. 音频包络

- 根据真实 `sampleRate / fftSize` 精确解析 20–180Hz bin。
- 使用 RMS、噪声底与 45ms attack / 220ms release 生成稳定的 0–1 低频包络。
- 音频采样继续固定为 60Hz，中央视觉仍跟随显示器每一帧。

### 2. 线框视觉

- 新增独立 detail-3 `IcosahedronGeometry` 叠层，不修改旧 Planet 几何。
- vertex shader 使用 3D noise，仅由低频包络控制法线方向形变。
- fragment shader 使用 `#b829e3` 紫色、Fresnel 边缘光和有上限的透明度。
- 静音时保持接近圆形；低频增强时形成有边界的尖峰，最大位移受 clamp 限制。

### 3. 平滑切换与可访问性

- 使用约 260ms 的可中断交叉过渡；连续切换从当前混合值反向，不排队。
- 线框出现时适度降低周边 Planet 光效，返回 Planet 时连续恢复。
- 视觉模式使用 radio 语义、`aria-checked` 与 roving `tabindex`。
- `prefers-reduced-motion` 下只绘制静态帧，不维持持续动画循环。

### 4. 性能与资源所有权

- Planet 稳定态仍为原三次 sphere pass；Pulse Wire 稳定态为两次 pass。
- 只有模式过渡期间短暂同时绘制两套 pass。
- teardown 取消 RAF、移除监听器、释放 geometry/material/texture/renderer，并断开和关闭 Web Audio 资源。

## 验收门槛

- `npm run check`、renderer module syntax、`git diff --check` 全通过。
- `npm run audit:high` 为 0 个运行时高危漏洞。
- 实机确认 Planet → Pulse Wire → Liquid Aura → Planet 均可用，快速反向切换无卡死或闪烁。
- 播放真实歌曲时线框随低频响应，歌词、队列、音量和播放控制无回归。
- 60Hz 实机贴合刷新上限；90/120Hz 由刷新率无关单测覆盖，并保留在对应硬件上的最终验收项。
- 打包产物独立启动并连接随包 API 后，才允许替换桌面版本。
