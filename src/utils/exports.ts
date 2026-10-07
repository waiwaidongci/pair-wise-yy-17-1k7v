import type { Course, RouteAnalysis } from '../types/course';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJudgeSheet(course: Course, analysis: RouteAnalysis) {
  const lines = [
    ['路线', course.name],
    ['场地', `${course.arena.width} × ${course.arena.length} m`, course.arena.surface],
    ['马匹', course.horse.name, `步幅 ${course.horse.stepLength} m`],
    [],
    ['跳次', '障碍名称', '高度(cm)', '距下一跳(m)', '实测步数', '推荐步数', '转角(度)', '判定'],
    ...analysis.rows.map((row) => {
      const obstacle = course.obstacles.find((item) => item.id === row.fromId);
      return [
        row.fromNumber,
        obstacle?.name ?? '',
        obstacle?.height ?? '',
        row.distance,
        row.strides,
        row.recommended,
        row.turnAngle,
        row.level === 'ok' ? '合理' : row.level === 'warning' ? '需注意' : '有风险',
      ];
    }),
    [],
    ['安全评分', analysis.score],
    ['总距离', analysis.totalDistance],
    ['预计用时', analysis.estimatedSeconds],
    ['风险条目', analysis.issues.map((item) => item.title).join('；') || '无'],
  ];
  const csv = lines
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  downloadBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${course.name}-裁判表.csv`);
}

export function openPrintableCourse(course: Course, analysis: RouteAnalysis, imageUrl: string) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=900');
  if (!printWindow) return;
  const rows = analysis.rows
    .map((row) => {
      const obstacle = course.obstacles.find((item) => item.id === row.fromId);
      return `<tr><td>${row.fromNumber}</td><td>${obstacle?.name ?? ''}</td><td>${row.distance} m</td><td>${row.strides} / ${row.recommended}</td><td>${row.turnAngle}°</td></tr>`;
    })
    .join('');
  printWindow.document.write(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>${course.name} - 路线图</title>
        <style>
          body { font-family: "PingFang SC", sans-serif; color: #1f2937; margin: 28px; }
          header { display: flex; justify-content: space-between; align-items: end; border-bottom: 2px solid #1f2937; padding-bottom: 12px; }
          h1 { margin: 0; font-size: 24px; }
          .meta { font-size: 12px; color: #64748b; text-align: right; }
          .route-image { display: block; width: 100%; max-height: 920px; object-fit: contain; margin: 20px 0; border: 1px solid #cbd5e1; }
          table { border-collapse: collapse; width: 100%; font-size: 11px; margin-top: 14px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
          th { background: #f1f5f9; }
          .note { margin-top: 18px; font-size: 11px; color: #64748b; }
          @media print { button { display: none; } body { margin: 12mm; } .route-image { max-height: 760px; } }
        </style>
      </head>
      <body>
        <header><div><h1>${course.name}</h1><div>马术场地障碍路线与步数表</div></div><div class="meta">${course.arena.width} × ${course.arena.length} m · ${course.arena.surface}<br>马匹 ${course.horse.name} · 步幅 ${course.horse.stepLength} m</div></header>
        <img class="route-image" src="${imageUrl}" alt="路线图">
        <table><thead><tr><th>跳次</th><th>障碍</th><th>距下一跳</th><th>实测/推荐步数</th><th>转角</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="note">安全评分 ${analysis.score}/100 · 总距离 ${analysis.totalDistance} m · 预计通过时间 ${analysis.estimatedSeconds} 秒</div>
        <button onclick="window.print()">打印</button>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
}

