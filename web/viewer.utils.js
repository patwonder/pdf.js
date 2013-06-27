"use strict"

/**
*
*  Base64 encode / decode
*  http://www.webtoolkit.info/
*
**/
 
var Base64 = {
	// private property
	_keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
 
	// public method for encoding
	encode : function (input) {
    input = Base64._utf8_encode(input);
    return this._base64_encode(input);
  },
  
  // public method for decoding
	decode : function (input) {
    input = this._base64_decode(input);
    return Base64._utf8_decode(input);
  },

  _base64_encode: function(input) {
    if (typeof(window.btoa) == "function") {
      this._base64_encode = function(input) btoa(input);
    } else {
      this._base64_encode = function(input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        while (i < input.length) {
     
          chr1 = input.charCodeAt(i++);
          chr2 = input.charCodeAt(i++);
          chr3 = input.charCodeAt(i++);
     
          enc1 = chr1 >> 2;
          enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
          enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
          enc4 = chr3 & 63;
     
          if (isNaN(chr2)) {
            enc3 = enc4 = 64;
          } else if (isNaN(chr3)) {
            enc4 = 64;
          }
     
          output = output +
          this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
          this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
        }
     
        return output;
      }
    }
    return this._base64_encode(input);
	},

  _base64_decode: function(input) {
    if (typeof(window.atob) == "function") {
      this._base64_decode = function(input) atob(input);
    } else {
      this._base64_decode = function(input) {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;
        
        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
     
        while (i < input.length) {
          enc1 = this._keyStr.indexOf(input.charAt(i++));
          enc2 = this._keyStr.indexOf(input.charAt(i++));
          enc3 = this._keyStr.indexOf(input.charAt(i++));
          enc4 = this._keyStr.indexOf(input.charAt(i++));
     
          chr1 = (enc1 << 2) | (enc2 >> 4);
          chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
          chr3 = ((enc3 & 3) << 6) | enc4;
     
          output = output + String.fromCharCode(chr1);
     
          if (enc3 != 64) {
            output = output + String.fromCharCode(chr2);
          }
          if (enc4 != 64) {
            output = output + String.fromCharCode(chr3);
          }
        }
     
        return output;
      }
    }
    return this._base64_decode(input);
	},
 
	// private method for UTF-8 encoding
	_utf8_encode : function (string) {
		string = string.replace(/\r\n/g,"\n");
		var utftext = "";
 
		for (var n = 0; n < string.length; n++) {
			var c = string.charCodeAt(n);
 
			if (c < 128) {
				utftext += String.fromCharCode(c);
			}
			else if((c > 127) && (c < 2048)) {
				utftext += String.fromCharCode((c >> 6) | 192);
				utftext += String.fromCharCode((c & 63) | 128);
			}
			else {
				utftext += String.fromCharCode((c >> 12) | 224);
				utftext += String.fromCharCode(((c >> 6) & 63) | 128);
				utftext += String.fromCharCode((c & 63) | 128);
			}
		}
 
		return utftext;
	},
 
	// private method for UTF-8 decoding
	_utf8_decode : function (utftext) {
		var string = "";
		var i = 0;
		var c = c1 = c2 = 0;
 
		while ( i < utftext.length ) {
			c = utftext.charCodeAt(i);
 
			if (c < 128) {
				string += String.fromCharCode(c);
				i++;
			}
			else if((c > 191) && (c < 224)) {
				c2 = utftext.charCodeAt(i+1);
				string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
				i += 2;
			}
			else {
				c2 = utftext.charCodeAt(i+1);
				c3 = utftext.charCodeAt(i+2);
				string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
				i += 3;
			}
		}
    
		return string;
	}
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
  
  cjkRanges: [
    [0x3400, 0x4DB5],
    [0x4E00, 0x9FA5],
    [0x9FA6, 0x9FBB],
    [0xF900, 0xFA2D],
    [0xFA30, 0xFA6A],
    [0xFA70, 0xFAD9],
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
    return ranges.some(function(range) code >= range[0] && code <= range[1])
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
      return ct1 === CT.HYPHENABLE && ct2 === CT.HYPHENABLE ? "dehyphen" : false;
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
