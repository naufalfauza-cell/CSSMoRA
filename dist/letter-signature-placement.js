// PDF.js viewport coordinates are measured from the visible top-left corner.
// pdf-lib draws from the bottom-left in unrotated PDF page coordinates.
// Mapping both basis vectors also handles CropBox offsets and rotated pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSSMoRALetterPlacement = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function placementToPdf(viewport, rectangle) {
    const { x, y, w, h } = rectangle;
    if (![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || y+h > 1.000001) {
      throw new Error('Posisi tanda tangan berada di luar halaman.');
    }
    const left=x*viewport.width, bottom=(y+h)*viewport.height;
    const origin=viewport.convertToPdfPoint(left,bottom);
    const right=viewport.convertToPdfPoint((x+w)*viewport.width,bottom);
    const top=viewport.convertToPdfPoint(left,y*viewport.height);
    return {
      x:origin[0],y:origin[1],
      width:Math.hypot(right[0]-origin[0],right[1]-origin[1]),
      height:Math.hypot(top[0]-origin[0],top[1]-origin[1]),
      rotation:Math.atan2(right[1]-origin[1],right[0]-origin[0])*180/Math.PI
    };
  }
  return {placementToPdf};
});
