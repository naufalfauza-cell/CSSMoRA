const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placementToPdf } = require('../dist/letter-signature-placement.js');

function viewport(rotation, crop={x:40,y:75,width:500,height:720}) {
  // PDF.js page display rotates around the CropBox. These are inverse
  // transforms from screen (top-left) back into PDF user-space coordinates.
  const {x,y,width,height}=crop;
  const mappings=[
    {width,height,inverse:(u,v)=>[x+u,y+height-v],forward:(a,b)=>[a-x,y+height-b]},
    {width:height,height:width,inverse:(u,v)=>[x+v,y+u],forward:(a,b)=>[b-y,a-x]},
    {width,height,inverse:(u,v)=>[x+width-u,y+v],forward:(a,b)=>[x+width-a,b-y]},
    {width:height,height:width,inverse:(u,v)=>[x+width-v,y+height-u],forward:(a,b)=>[y+height-b,x+width-a]}
  ];
  const map=mappings[rotation/90];
  return {...map,convertToPdfPoint:map.inverse};
}

for (const degrees of [0,90,180,270]) {
  test(`signature stays in visible rectangle on a ${degrees}° PDF page`,()=>{
    const page=viewport(degrees);
    const box={x:.48,y:.63,w:.27,h:.12};
    const actual=placementToPdf(page,box);
    assert.ok(actual.width>0&&actual.height>0);
    const angle=actual.rotation*Math.PI/180;
    const corners=[
      [actual.x,actual.y],
      [actual.x+actual.width*Math.cos(angle),actual.y+actual.width*Math.sin(angle)],
      [actual.x-actual.height*Math.sin(angle),actual.y+actual.height*Math.cos(angle)]
    ].map(([a,b])=>page.forward(a,b));
    const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} should equal ${b}`);
    near(corners[0][0],box.x*page.width);near(corners[0][1],(box.y+box.h)*page.height);
    near(corners[1][0],(box.x+box.w)*page.width);near(corners[1][1],(box.y+box.h)*page.height);
    near(corners[2][0],box.x*page.width);near(corners[2][1],box.y*page.height);
  });
}
test('signature cannot leave the selected PDF page',()=>{
  assert.throws(()=>placementToPdf(viewport(0),{x:.3,y:.9,w:.2,h:.2}),/luar halaman/);
  assert.throws(()=>placementToPdf(viewport(0),{x:.3,y:NaN,w:.2,h:.2}),/luar halaman/);
});

test('signature may extend past the right edge and is clipped by the PDF page',()=>{\n  const page=viewport(0);\n  const actual=placementToPdf(page,{x:1.2,y:.5,w:.2,h:.2});\n  assert.ok(actual.x>page.width);\n  assert.equal(actual.width,.2*page.width);\n});\n