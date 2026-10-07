# StridePlan 马术障碍路线设计器

基于 React、TypeScript、Vite、Mantine、Zustand 和 React Router 构建。场地和障碍使用
Canvas 按真实米制尺寸绘制，所有数据保存在浏览器本地。

## 功能

- 标准 60 × 90 米场地、栅格吸附和缩放
- 障碍类型 / 颜色库、编号、旋转、拖动和顺序调整
- 按马匹步幅、接近段、落地段计算推荐步数
- 距离不合理、转角过急和路线交叉实时检查
- 按难度生成三套备选路线并一键应用
- 撤销重做、本地路线库、分享链接
- 可打印路线图和裁判用 CSV 表

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm build
corepack pnpm dev
```

