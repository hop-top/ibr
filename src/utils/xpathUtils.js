/**
 * Generates an XPath for the given element
 * @param {string} parentXPath - The XPath of the parent element
 * @param {Object} element - The element to generate XPath for (must have parentNode and tagName properties)
 * @returns {string} The generated XPath
 */
export function generateElementXPath(parentXPath, element) {
  const elementsWithSameTagName = element.parentNode.children.filter((child) => {
    return child.tagName === element.tagName;
  });
  const index = elementsWithSameTagName.indexOf(element);
  return `${parentXPath}/${element.tagName}${elementsWithSameTagName.length > 1 ? `[${index + 1}]` : ""}`;
}
