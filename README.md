# Snake on Surfaces

Snake on Surfaces is a browser game that turns the classic snake mechanic into a topology playground. Instead of moving on a flat rectangle, the snake lives on surfaces such as the sphere, torus, genus-2 surface, Mobius strip, projective plane, and Klein bottle.

The goal is usually to form an Ouroboros: the snake closes into a loop. Different surfaces use different winning conditions, so the game makes fundamental-group and surface-identification ideas visible through play.

## Features

- Six playable surfaces: sphere, torus, genus 2, Mobius strip, projective plane, and Klein bottle.
- 3D surface view plus a local chart view.
- Surface-specific loop detection.
- Optional topology hints showing cuts and the current group calculation.
- English and Chinese UI.
- Desktop keyboard controls and mobile swipe controls.
- Mobile 3D gestures: one-finger rotate, two-finger pinch zoom.

## Play

Open `index.html` in a browser and choose a surface.

## Controls

Desktop:

- Arrow keys or WASD: move the snake
- P or Space: pause
- Drag the 3D view: rotate the surface
- Mouse wheel: zoom
- R or Reset Camera: reset the view

Mobile:

- Swipe on the chart area, or the horizontal touch band at the chart height: move the snake
- Drag the 3D view with one finger: rotate the surface
- Pinch the 3D view with two fingers: zoom

## Winning Goals

- Sphere: form any closed loop.
- Torus: form a nontrivial loop.
- Genus 2: form a nontrivial loop.
- Projective plane: form a nontrivial loop.
- Mobius strip: form a nontrivial loop without crossing the boundary.
- Klein bottle: form a nontrivial loop.

## Customization

Useful constants are near the top of `snake3d.html`.

- Initial speed: `INITIAL_SPEED_MS`. Smaller values are faster.
- Genus-2 default camera: `GENUS2_CAMERA_POSITION`.
- Mobile camera zoom: `MOBILE_CAMERA_DISTANCE_SCALE`. Smaller values zoom in more on mobile.
- Food counts: `INITIAL_FOODS`, `MIN_FOODS`, `MAX_FOODS`.
- Food weights and colors: `FOOD_DEF`.

The index page previews can either use the built-in rotating 3D previews or custom images. To use a custom image, set `data-image` on a `.map-card` in `index.html`.

## Repository

GitHub: <https://github.com/lixingying/snake3D>

## Rights, License, and Attribution

Copyright 2026 Xingying Li.

This project is licensed under the Apache License, Version 2.0. See `LICENSE` and `NOTICE`.

In practical terms, this means others may use, copy, modify, and distribute the code, but they must keep the copyright notice, the license text, and the NOTICE attribution. Modified versions should also make clear that they changed the original work.

Suggested attribution:

```text
Based on Snake on Surfaces by Xingying Li.
```

If you publish a modified version, please keep the project name and author attribution in the source, documentation, or credits area.

## 中文说明

# 蛇蛇教你学拓扑

Snake on Surfaces 是一个把经典贪吃蛇玩法放到拓扑曲面上的浏览器游戏。蛇不再生活在普通平面上，而是在球面、环面、双孔曲面、莫比乌斯带、射影平面、克莱因瓶等曲面上移动。

游戏目标通常是形成 衔尾蛇，也就是蛇首尾相接形成闭合环路。不同曲面有不同的胜利条件，因此玩家可以在游戏中直观看到基本群、边粘合、cut 和非平凡环路等概念。

## 功能

- 六张曲面地图：球面、环面、双孔曲面、莫比乌斯带、射影平面、克莱因瓶。
- 3D 曲面视图和局部地图视图。
- 针对不同曲面的环路判定。
- 可选拓扑提示：显示 cut 和当前群计算。
- 英文和中文界面。
- 支持桌面键盘控制和手机滑动控制。
- 手机端 3D 手势：单指旋转，双指捏合缩放。

## 运行

用浏览器打开 `index.html`，然后选择曲面即可。

## 操作

桌面端：

- 方向键或 WASD：控制蛇移动
- P 或空格：暂停
- 拖拽 3D 视图：旋转曲面
- 鼠标滚轮：缩放
- R 或重置视角：重置视图

手机端：

- 在局部地图上滑动，或在局部地图同一高度的横向触控区域滑动：控制蛇移动
- 在 3D 视图单指拖拽：旋转曲面
- 在 3D 视图双指捏合：缩放

## 胜利目标

- 球面：形成任意闭合环路。
- 环面：形成非平凡环路。
- 双孔曲面：形成非平凡环路。
- 射影平面：形成非平凡环路。
- 莫比乌斯带：形成不跨边界的非平凡环路。
- 克莱因瓶：形成非平凡环路。

## 自定义参数

常用参数在 `snake3d.html` 前部。

- 初始速度：`INITIAL_SPEED_MS`。数值越小，蛇越快。
- 双孔曲面默认相机：`GENUS2_CAMERA_POSITION`。
- 手机端相机距离：`MOBILE_CAMERA_DISTANCE_SCALE`。数值越小，手机端越放大。
- 食物数量：`INITIAL_FOODS`、`MIN_FOODS`、`MAX_FOODS`。
- 食物权重和颜色：`FOOD_DEF`。

首页预览可以使用内置的旋转 3D 预览，也可以换成自己的图片。要换图，在 `index.html` 的 `.map-card` 上填写 `data-image`。

## 权利、许可证与署名

版权所有 2026 Xingying Li。

本项目基于 Apache License, Version 2.0 发布。请查看 `LICENSE` 和 `NOTICE`。

通俗地说，别人可以使用、复制、修改和发布这份代码，但必须保留版权声明、许可证文本和 NOTICE 署名信息。修改版本也应该说明它是基于原作修改的。

建议署名格式：

```text
Based on Snake on Surfaces by Xingying Li.
```

如果别人发布修改版，请在源码、文档或致谢区域保留项目名称和作者署名。
