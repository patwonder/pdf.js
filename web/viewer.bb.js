"use strict"

var BoundingBoxType = {
  TEXT: 1,
  IMAGE: 2,
  PRIMITIVE: 3
};

function BoundingBox(left, top, width, height) {
  this.left = left;
  this.top = top;
  this.width = width;
  this.height = height;
}

BoundingBox.prototype = {
  get right() {
    return this.left + this.width;
  },
  get bottom() {
    return this.top + this.height;
  }
};

BoundingBox.fromGeometry = function(geom) {
  var fontHeight = geom.fontSize * Math.abs(geom.vScale);
  return new BoundingBox(
    /*left*/geom.x,
    /*top*/geom.y - fontHeight,
    /*width*/geom.canvasWidth * geom.hScale,
    /*height*/fontHeight);
};

function BoundingBoxLayerBuilder(bbLayerDiv, pageIdx) {
  this._bbLayerFrag = document.createDocumentFragment();
  
  this.bbLayerDiv = bbLayerDiv;
  this.pageIdx = pageIdx;
  this.layoutDone = false;
  
  this.isSelecting = false;
  this.selectionBB = new BoundingBox(0, 0, 0, 0);
}

BoundingBoxLayerBuilder.prototype = {
  beginLayout: function() {
    this.bbDivs = [];
    this.bbContents = [];
  },
  
  endLayout: function() {
    this.layoutDone = true;
    this.insertDivContent();
  },
  
  renderLayer: function() {
    var self = this;
    var bbDivs = this.bbDivs;
    var bbLayerDiv = this.bbLayerDiv;
    var bbLayerFrag = this._bbLayerFrag;
    
    // No point in rendering so many divs as it'd make the browser unusable
    // even after the divs are rendered
    var MAX_TEXT_DIVS_TO_RENDER = 100000;
    if (bbDivs.length > MAX_TEXT_DIVS_TO_RENDER)
      return;

    for (var i = 0, l = bbDivs.length; i < l; i++) {
      var bbDiv = bbDivs[i];
      var content = this.bbContents[parseInt(bbDiv.dataset.contentIdx)];
      if (content && content.type == BoundingBoxType.TEXT)
        bbDiv.dataset.text = content.textContent;
      bbLayerFrag.appendChild(bbDiv);
    }
    
    this.renderingDone = true;
    
    bbLayerDiv.appendChild(bbLayerFrag);
    
    // Add event listeners for bounding box layer selection
    bbLayerDiv.addEventListener("mousedown", this.onMouseDown.bind(this), false);
    bbLayerDiv.addEventListener("mouseup", this.onMouseUp.bind(this), false);
  },
  
  setupRenderLayoutTimer: function() {
    // Schedule renderLayout() if user has been scrolling, otherwise
    // run it right away
    var RENDER_DELAY = 200; // in ms
    var self = this;
    if (Date.now() - PDFView.lastScroll > RENDER_DELAY) {
      // Render right away
      this.renderLayer();
    } else {
      // Schedule
      if (this.renderTimer)
        clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(function() {
        self.setupRenderLayoutTimer();
      }, RENDER_DELAY);
    }
  },
  
  appendBoundingBox: function(bb, content) {
    if (!content.hide) {
      var bbDiv = document.createElement("div");
      
      bbDiv.dataset.pageIdx = this.pageIdx;
      bbDiv.dataset.contentIdx = this.bbContents.length;
      
      bbDiv.style.left = bb.left + "px";
      bbDiv.style.top = bb.top + "px";
      bbDiv.style.width = bb.width + "px";
      bbDiv.style.height = bb.height + "px";
      
      this.bbDivs.push(bbDiv);
    }
    this.bbContents.push(content);
  },
  
  setTextContent: function(textContent) {
    this.textContent = textContent;
    this.insertDivContent();
  },
  
  insertDivContent: function() {
    // Only set the content of the divs once layout has finished, the content
    // for the divs is available and content is not yet set on the divs.
    if (!this.layoutDone || this.divContentDone || !this.textContent)
      return;

    this.divContentDone = true;

    var bbContents = this.bbContents;
    var bidiTexts = this.textContent.bidiTexts;

    // Assign text content from the textContent we just get
    for (var i = 0, j = 0, l = bidiTexts.length; i < l; i++) {
      var bidiText = bidiTexts[i];
      while (bbContents[j++].type != BoundingBoxType.TEXT);
      
      bbContents[j - 1].textContent = bidiText.str;
    }

    this.setupRenderLayoutTimer();
  },
  
  // Selection event handling
  onMouseDown: function(event) {
    // do not process clicks on the clip button, etc
    var target = event.target;
    while (target != this.bbLayerDiv) {
      if (/(?:^|\s)bypassSelection(?:$|\s)/.test(target.className))
        return;
      target = target.parentElement;
    }
    
    // We wanna handle all subsequent mouse events on the layer div
    // It's not necessary to bubble everything up
    this.bbLayerDiv.setCapture(true);
    
    // If listener still bound, e.g. due to focus lost while selecting,
    // we should not try to initiate another selection gesture
    if (this._onMouseMoveBinded)
      return;
    
    this._onMouseMoveBinded = this.onMouseMove.bind(this);
    this.bbLayerDiv.addEventListener("mousemove", this._onMouseMoveBinded, false);
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionStart(pos);
  },
  
  onMouseUp: function(event) {
    // do not handle when no event handler is bound
    if (!this._onMouseMoveBinded)
      return;

    this.onMouseMove(event);
    this.bbLayerDiv.removeEventListener("mousemove", this._onMouseMoveBinded,
    false);
    this._onMouseMoveBinded = null;
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionEnd(pos);
  },
  
  onMouseMove: function(event) {
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionMove(pos);
  },
  
  onSelectionStart: function(pos) {
    var selectionBB = this.selectionBB = new BoundingBox(pos.left, pos.top, 1, 1);
    
    // Create the div for displaying the selection
    var selectionDiv = this.selectionDiv || (this.selectionDiv = document.createElement("div"));
    selectionDiv.className = "bbLayerSelection bypassSelection";
    selectionDiv.style.left = selectionBB.left + "px";
    selectionDiv.style.top = selectionBB.top + "px";
    selectionDiv.style.width = selectionBB.width + "px";
    selectionDiv.style.height = selectionBB.height + "px";
    selectionDiv.style.visibility = "hidden";
    this.bbLayerDiv.appendChild(selectionDiv);
    
    if (this._clipButton) {
      this._clipButton.style.visibility = "hidden";
    }
  },
  
  onSelectionEnd: function(pos) {
    var clipButton = this._clipButton;
    if (!clipButton) {
      clipButton = this._clipButton = document.createElement("button");
      clipButton.className = "clipButton bypassSelection";
      clipButton.innerHTML = "Clip";
      clipButton.style.zIndex = 1;
      clipButton.addEventListener("click", function(event) {
        this.doClip();
      }.bind(this), false);
      this.bbLayerDiv.appendChild(clipButton);
    }
    clipButton.style.left = pos.left + "px";
    clipButton.style.top = pos.top + "px";
    clipButton.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";
  },
  
  onSelectionMove: function(pos) {
    var selectionBB = this.selectionBB;
    var selectionDiv = this.selectionDiv;

    selectionBB.width = pos.left - selectionBB.left + 1;
    selectionBB.height = pos.top - selectionBB.top + 1;
    
    var tempBB = this.getSelectionBB();
    
    selectionDiv.style.left = tempBB.left + "px";
    selectionDiv.style.top = tempBB.top + "px";
    selectionDiv.style.width = tempBB.width + "px";
    selectionDiv.style.height = tempBB.height + "px";
    selectionDiv.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";
  },
  
  getSelectionBB: function() {
    var selectionBB = this.selectionBB;

    // handle reversed selection
    var tempBB = new BoundingBox(selectionBB.left, selectionBB.top,
      selectionBB.width, selectionBB.height);
    if (tempBB.width <= 0) {
      tempBB.left += tempBB.width - 1;
      tempBB.width = -tempBB.width + 2;
    }
    if (tempBB.height <= 0) {
      tempBB.top += tempBB.height - 1;
      tempBB.height = -tempBB.height + 2;
    }
    return tempBB;
  },
  
  isSelectionVisible: function() {
    var MIN_BB_SELECTION_WIDTH = 4;
    var MIN_BB_SELECTION_HEIGHT = 4;
    var tempBB = this.getSelectionBB();
    return tempBB.width >= MIN_BB_SELECTION_WIDTH && tempBB.height >= MIN_BB_SELECTION_HEIGHT;
  },
  
  doClip: function() {
    // iterate through every bounding box and do intersection
    
  }
};
