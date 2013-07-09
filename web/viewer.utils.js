"use strict"

if(!('contains' in String.prototype))
  String.prototype.contains = function(str, startIndex) {
    return -1 !== String.prototype.indexOf.call(this, str, startIndex);
  };

var Utils = {
  assertEquals: function(actual, expected, expression) {
    if (actual !== expected) {
      throw new Error("Assertion failed: Expression " + expression + 
        ",\n\texpected " + expected + ", actual result is " + actual);
    }
  },
  
  // Return the position of the topleft corner of the client area relative to 
  // the entire document
  getClientPosition: function(element) {
    if (!element) return { left: 0, top: 0 };
    var bb = element.getBoundingClientRect();
    var left = bb.left + window.pageXOffset;
    var top = bb.top + window.pageYOffset;
    return { left: left, top: top };
  },
  
  // Return the position of pos relative to element2's client area
  // where pos is a position relative to element1's client area
  // Use null for the element to specify position relative to the document
  translatePosition: function(pos, element1, element2) {
    var pos1 = Utils.getClientPosition(element1);
    var pos2 = Utils.getClientPosition(element2);
    return {
      left: pos.left + pos1.left - pos2.left,
      top: pos.top + pos1.top - pos2.top
    };
  },
  
  // Getting the html representation of a plain text
  getHtmlEntities: function(str) {
    var pre = document.createElement("pre");
    pre.textContent = str;
    return pre.innerHTML;
  },
  
  matchesSelector: function(element, selector) {
    if (element.mozMatchesSelector) {
      return element.mozMatchesSelector(selector);
    } else if (element.webkitMatchesSelector) {
      return element.webkitMatchesSelector(selector);
    } else if (element.matchesSelector) {
      return element.matchesSelector(selector);
    } else {
      try {
        var elems = element.parentElement ? element.parentElement.querySelectorAll(selector) : [];
        for (var i = 0, l = elems.length; i < l; i++) {
          if (elems[i] === element) return true;
        }
      } catch (ex) { }
      return false;
    }
  },
  
  CharType: {
    HYPHENABLE: 0,
    NUMBER: 1,
    LEFT_ASSOC_PUNCTUATION: 2,
    RIGHT_ASSOC_PUNCTUATION: 3,
    CJK: 4,
    HYPHEN: 5,
    OTHER: 6
  },
  
  leftAssocPunctuations: ",.;!?:)]}",
  rightAssocPunctuations: "([{",
  
  // Combined from http://www.ipmtea.net/javascript/201009/23_292.html
  cjkRanges: [
    [0x1100, 0x11FF],
    [0x2600, 0x27BF],
    [0x2800, 0x28FF],
    [0x2E80, 0x2FDF],
    [0x2FF0, 0x318F],
    [0x31A0, 0x31EF],
    [0x3200, 0x4DB5],
    [0x4DC0, 0x9FBB],
    [0xA000, 0xA4CF],
    [0xAC00, 0xD7AF],
    [0xF900, 0xFA2D],
    [0xFA30, 0xFA6A],
    [0xFA70, 0xFAD9],
    [0xFE10, 0xFE1F],
    [0xFE30, 0xFE4F],
    [0xFF00, 0xFFEF],
    [0x1D300, 0x1D35F],
    [0x20000, 0x2A6D6],
    [0x2F800, 0x2FA1D]
  ],
  
  // See http://git.ghostscript.com/?p=mupdf.git;a=blob;f=fitz/dev_text.c;h=84081225bcdb77f038179648065973f7461a6890;hb=abc577439ea5f86381832b8d6ea4b2458f7805b8#l2084
  hyphenableRanges: [
    [65, 90],
    [97, 122],
    [0x00C0, 0x00D6],
    [0x00D8, 0x00F6],
    [0x00F8, 0x02AF],
    [0x1D00, 0x1DBF],
    [0x1E00, 0x1EFF],
    [0x2C60, 0x2C7F],
    [0xA722, 0xA78E],
    [0xA790, 0xA793],
    [0xA7A8, 0xA7AF],
    [0xFB00, 0xFB07],
    [0xFF21, 0xFF3A],
    [0xFF41, 0xFF5A]
  ],
  
  inRanges: function(code, ranges) {
    if (code < ranges[0][0] || code > ranges[ranges.length - 1][1])
      return false;
    return ranges.some(function(range) {
      return code >= range[0] && code <= range[1];
    });
  },
  
  isHyphen: function(code) {
    // We omit 0x2011 (Non breaking hyphen) and 0x2043 (Hyphen Bullet)
    // from this list.
    return (code === 45
         || code === 0x2010 /* Hyphen */
         || code === 0x002d /* Hyphen-Minus */
         || code === 0x00ad /* Soft hyphen */
         || code === 0x058a /* Armenian Hyphen */
         || code === 0x1400 /* Canadian Syllabive Hyphen */
         || code === 0x1806 /* Mongolian Todo soft hyphen */
    );
  },
  
  getCharType: function(code) {
    var CT = Utils.CharType;
    if (Utils.inRanges(code, Utils.hyphenableRanges))
      return CT.HYPHENABLE;
    if (code >= 48 && code <= 57)
      return CT.NUMBER;
    if (Utils.isHyphen(code))
      return CT.HYPHEN;
    if (Utils.inRanges(code, Utils.cjkRanges))
      return CT.CJK;
    
    var ch = String.fromCharCode(code);
    if (Utils.leftAssocPunctuations.contains(ch))
      return CT.LEFT_ASSOC_PUNCTUATION;
    if (Utils.rightAssocPunctuations.contains(ch))
      return CT.RIGHT_ASSOC_PUNCTUATION;
    return CT.OTHER;
  },
  
  /**
   * Whether we should concat the text
   *  true: concat directly
   *  false: concat with space " "
   *  "dehyphen": concat dehyphened
   */
  shouldConcatText: function(part1, part2, isSameLine) {
    if (part1.length === 0 || part2.length === 0) return false;
    var code1 = part1.charCodeAt(part1.length - 1);
    var code2 = part2.charCodeAt(0);
    var CT = Utils.CharType;
    var ct1 = Utils.getCharType(code1);
    var ct2 = Utils.getCharType(code2);
    var hyphen = false;
    if (ct1 === CT.HYPHEN) {
      hyphen = true;
      ct1 = part1.length >= 2 ? Utils.getCharType(part1.charCodeAt(part1.length - 2)) : CT.OTHER;
    }
    if (ct2 === CT.HYPHEN) {
      hyphen = true;
      ct2 = part2.length >= 2 ? Utils.getCharType(part2.charCodeAt(1)) : CT.OTHER;
    }
    if (ct1 === CT.OTHER || ct2 === CT.OTHER)
      return false;
    if (hyphen) {
      return ct1 === CT.HYPHENABLE && ct2 === CT.HYPHENABLE && !isSameLine ? "dehyphen" : false;
    }
    if (ct1 === CT.RIGHT_ASSOC_PUNCTUATION || ct2 === CT.LEFT_ASSOC_PUNCTUATION)
      return true;
    if (ct1 === CT.CJK && ct2 === CT.CJK) return true;
    return false;
  },
  
  dehyphenate: function(part1, part2) {
    var code1 = part1.charCodeAt(part1.length - 1);
    var code2 = part2.charCodeAt(0);
    var CT = Utils.CharType;
    var ct1 = Utils.getCharType(code1);
    var ct2 = Utils.getCharType(code2);
    if (ct1 === CT.HYPHEN) {
      part1 = part1.substring(0, part1.length - 1);
    }
    if (ct2 === CT.HYPHEN) {
      part2 = part2.substring(1);
    }
    return { part1: part1, part2: part2 };
  },
};
