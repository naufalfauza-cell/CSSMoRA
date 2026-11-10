const paragraphFields = ["alignment", "lineSpacing", "spaceAbove", "spaceBelow", "indentFirstLine", "indentStart", "indentEnd", "direction", "keepWithNext", "keepLinesTogether"];
const textFields = ["weightedFontFamily", "fontSize", "bold", "italic", "underline", "foregroundColor", "link", "baselineOffset"];

function selectStyle(style: Record<string, unknown> | undefined, keys: string[]) {
  return Object.fromEntries(keys.filter(key => style?.[key] != null).map(key => [key, style?.[key]]));
}

export function programLetterheadRequests(source: any, target: any) {
  const segmentId = target.documentStyle?.defaultHeaderId;
  const targetHeader = target.headers?.[segmentId]?.content;
  const sourceHeader = source.headers?.[source.documentStyle?.defaultHeaderId]?.content;
  if (!targetHeader?.length || !sourceHeader?.length) return [];
  const edits: Record<string, unknown>[] = [];
  const images: Array<{ index: number; uri: string; objectSize: unknown }> = [];
  let text = "";
  let index = 0;

  for (const part of sourceHeader) {
    if (!part.paragraph) return [];
    const startIndex = index;
    for (const element of part.paragraph.elements || []) {
      if (element.inlineObjectElement) {
        const embedded = source.inlineObjects?.[element.inlineObjectElement.inlineObjectId]?.inlineObjectProperties?.embeddedObject;
        if (!embedded?.imageProperties?.contentUri || !embedded.size) return [];
        images.push({ index: text.length, uri: embedded.imageProperties.contentUri, objectSize: embedded.size });
        index++;
      } else if (element.textRun) {
        const content = element.textRun.content || "";
        const textStyle = selectStyle(element.textRun.textStyle, textFields);
        if (content && Object.keys(textStyle).length) edits.push({
          updateTextStyle: { range: { segmentId, startIndex: index, endIndex: index + content.length }, textStyle, fields: Object.keys(textStyle).join(",") },
        });
        index += content.length;
        text += content;
      }
    }
    const paragraphStyle = selectStyle(part.paragraph.paragraphStyle, paragraphFields);
    if (index > startIndex && Object.keys(paragraphStyle).length) edits.push({
      updateParagraphStyle: { range: { segmentId, startIndex, endIndex: index }, paragraphStyle, fields: Object.keys(paragraphStyle).join(",") },
    });
  }

  const endIndex = Number(targetHeader.at(-1)?.endIndex ?? 0) - 1;
  if (images.length !== 2 || !text.endsWith("\n") || endIndex < 0) return [];
  return [
    ...(endIndex ? [{ deleteContentRange: { range: { segmentId, startIndex: 0, endIndex } } }] : []),
    { insertText: { location: { segmentId, index: 0 }, text: text.slice(0, -1) } },
    ...images.reverse().map(({ index, ...image }) => ({ insertInlineImage: { location: { segmentId, index }, ...image } })),
    ...edits,
    { updateDocumentStyle: { documentStyle: { marginHeader: source.documentStyle.marginHeader || { magnitude: 0, unit: "PT" } }, fields: "marginHeader" } },
  ];
}
