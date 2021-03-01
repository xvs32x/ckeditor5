/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module table/tablecaption/tablecaptionediting
 */

import { Plugin } from 'ckeditor5/src/core';
import { enablePlaceholder } from 'ckeditor5/src/engine';
import { toWidgetEditable } from 'ckeditor5/src/widget';
import { first } from 'ckeditor5/src/utils';

/**
 * The table caption engine plugin.
 *
 * It registers proper converters. It takes care of adding a caption element if the table without it is inserted
 * to the model document.
 *
 * @extends module:core/plugin~Plugin
 */
export default class TableCaptionEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'TableCaptionEditing';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const schema = editor.model.schema;
		const view = editor.editing.view;
		const t = editor.t;

		schema.register( 'caption', {
			allowIn: 'table',
			allowContentOf: '$block',
			isLimit: true
		} );

		// View -> model converter for the data pipeline.
		editor.conversion.for( 'upcast' )
			.elementToElement( {
				view: matchTableCaptionViewElement,
				model: 'caption'
			} )
			.add( viewFigureToModel() );

		// Model -> view converter for the data pipeline.
		editor.conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer } ) => {
				if ( !isTable( modelElement.parent ) ) {
					return null;
				}

				return writer.createContainerElement( 'figcaption' );
			}
		} );

		// Model -> view converter for the editing pipeline.
		editor.conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer } ) => {
				if ( !isTable( modelElement.parent ) ) {
					return null;
				}

				const figcaptionElement = writer.createEditableElement( 'figcaption' );
				writer.setCustomProperty( 'imageCaption', true, figcaptionElement );

				enablePlaceholder( {
					view,
					element: figcaptionElement,
					text: t( 'Enter image caption' )
				} );

				return toWidgetEditable( figcaptionElement, writer );
			}
		} );

		// Captions.
		// conversion.for( 'upcast' ).elementToElement( { model: 'caption', view: 'caption' } );

		// <figure> => <table> + <figcaption> || <figcaption> + <table>
		// conversion.for( 'upcast' ).add(
		// 	dispatcher => dispatcher.on(
		// 		'element:figcaption',
		// 		( evt, data, conversionApi ) => {
		// 			const viewFigcaption = data.viewItem;

		// 			if ( !conversionApi.consumable.test( viewFigcaption, { name: true } ) ) {
		// 				return;
		// 			}

		// 			const viewParent = viewFigcaption.parent;
		// 			if ( viewParent.name !== 'figure' ) {
		// 				return;
		// 			}

		// 			const viewTable = Array.from( viewParent.getChildren() ).find( child => child.name === 'table' );

		// 			if ( !viewTable ) {
		// 				return;
		// 			}

		// 			const caption = conversionApi.writer.createElement( 'caption' );
		// 			if ( !conversionApi.safeInsert( caption, data.modelCursor ) ) {
		// 				return;
		// 			}
		// 			// conversionApi.writer.insert( figcaption, conversionApi.writer.createPositionBefore( viewTable ) );

		// 			conversionApi.updateConversionResult( caption, data );
		// 		}
		// 	)
		// );

		editor.editing.mapper.on( 'modelToViewPosition', mapModelPositionToView( view ) );
		editor.data.mapper.on( 'modelToViewPosition', mapModelPositionToView( view ) );
	}
}

// Creates a mapper callback that reverses the order of `<img>` and `<figcaption>` in the image.
// Without it, `<figcaption>` would precede the `<img>` in the conversion.
//
// <image>^</image> -> <figure><img>^<caption></caption></figure>
//
// @private
// @param {module:engine/view/view~View} editingView
// @returns {Function}
function mapModelPositionToView( editingView ) {
	return ( evt, data ) => {
		const modelPosition = data.modelPosition;
		const parent = modelPosition.parent;

		if ( !parent.is( 'element', 'table' ) ) {
			return;
		}

		const viewElement = data.mapper.toViewElement( parent );

		data.viewPosition = editingView.createPositionAt( viewElement, modelPosition.offset + 1 );
	};
}

/**
 * {@link module:engine/view/matcher~Matcher} pattern. Checks if a given element is a `<figcaption>` element that is placed
 * inside the image `<figure>` element.
 *
 * @param {module:engine/view/element~Element} element
 * @returns {Object|null} Returns the object accepted by {@link module:engine/view/matcher~Matcher} or `null` if the element
 * cannot be matched.
 */
export function matchTableCaptionViewElement( element ) {
	const parent = element.parent;

	if ( element.name == 'figcaption' && parent && parent.name == 'figure' && parent.hasClass( 'table' ) ) {
		return { name: true };
	}

	if ( element.name == 'caption' && parent && parent.name == 'table' ) {
		return { name: true };
	}

	return null;
}

/**
 * Checks if the provided model element is a `table`.
 *
 * @param {module:engine/model/element~Element} modelElement
 * @returns {Boolean}
 */
export function isTable( modelElement ) {
	return !!modelElement && modelElement.is( 'element', 'table' );
}

export function viewFigureToModel() {
	return dispatcher => {
		dispatcher.on( 'element:figure', converter );
	};

	function converter( evt, data, conversionApi ) {
		// Do not convert if this is not an "table figure".
		if ( !conversionApi.consumable.test( data.viewItem, { name: true, classes: 'table' } ) ) {
			return;
		}

		// Find an table element inside the figure element.
		const viewTable = getViewTableFromWidget( data.viewItem );

		// Do not convert if table element is absent, is missing src attribute or was already converted.
		if ( !viewTable || !conversionApi.consumable.test( viewTable, { name: true } ) ) {
			return;
		}

		// Convert view table to model table.
		const conversionResult = conversionApi.convertItem( viewTable, data.modelCursor );

		// Get table element from conversion result.
		const modelTable = first( conversionResult.modelRange.getItems() );

		// When table wasn't successfully converted then finish conversion.
		if ( !modelTable ) {
			return;
		}

		// Convert rest of the figure element's children as an table children.
		conversionApi.convertChildren( data.viewItem, modelTable );

		conversionApi.updateConversionResult( modelTable, data );
	}
}

export function getViewTableFromWidget( figureView ) {
	if ( figureView.is( 'element', 'table' ) ) {
		return figureView;
	}

	const figureChildren = [];

	for ( const figureChild of figureView.getChildren() ) {
		figureChildren.push( figureChild );

		if ( figureChild.is( 'element' ) ) {
			figureChildren.push( ...figureChild.getChildren() );
		}
	}

	return figureChildren.find( viewChild => viewChild.is( 'element', 'table' ) );
}

export function findFromWidget( figureView ) {
	if ( figureView.is( 'element', 'table' ) ) {
		return figureView;
	}

	const figureChildren = [];

	for ( const figureChild of figureView.getChildren() ) {
		figureChildren.push( figureChild );

		if ( figureChild.is( 'element' ) ) {
			figureChildren.push( ...figureChild.getChildren() );
		}
	}

	return figureChildren.find( viewChild => viewChild.is( 'element', 'table' ) );
}
