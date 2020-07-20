import { jaroWrinkerSimilarity } from "./string-similarity";
import { loadJSON, resolvePointer, Condition, testPointerCondition } from "./utils";

export interface PotentialMatch {
    leftElementIndex: number;
    rightElementIndex: number;
    confidence?: number; // only used in similarity functions
}

export interface MatchReport {
    matchedIndices: PotentialMatch[];
    unmatchedLeftIndices: number[];
    unmatchedRightIndices: number[];
}

export type MatchType = "literal" | "string-similarity"

type ConstraintConditionTuple = [Condition, AbstractMatchConstraint]

/**
 * This object houses match constraints and provides the ability to search
 * through all the match constraints.
 */
export class MatchConstraintsContainer {
    private constraints: ConstraintConditionTuple[];

    public tryGetConstraint(pointer: string) {
        for (let constraint of this.constraints) {
            if (testPointerCondition(pointer, constraint[0])) {
                return constraint[1];
            }
        }
        return null;
    }

    constructor(constraints: ConstraintConditionTuple[]) {
        this.constraints = constraints;
    }

    public static fromJson(obj: any): MatchConstraintsContainer {
        let constraints: ConstraintConditionTuple[] = [];
        for (const subobj of obj) {
            if (!subobj.hasOwnProperty('condition') || !subobj.hasOwnProperty('constraint')) {
                throw new Error(`Error decoding object ${subobj} into PathCondition`);
            }

            let condition = subobj['condition'] as Condition;
            let constraint = MatchConstraintFromJson(subobj['constraint']);

            let constraintTuple = [condition, constraint] as ConstraintConditionTuple;

            constraints.push(constraintTuple);
        }
        return new MatchConstraintsContainer(constraints);
    }

    public static fromFile(path: string): MatchConstraintsContainer {
        const rawObj = loadJSON(path);
        return this.fromJson(rawObj);
    }
}

function MatchConstraintFromJson(obj: any): AbstractMatchConstraint {
    if (!obj.hasOwnProperty('constraint_name')) {
        throw new Error(`Error decoding object ${obj} into MatchConstraint`);
    }

    switch (obj['constraint_name'] as string) {
        case PrimitiveMatchConstraint.name:
            return PrimitiveMatchConstraint.fromJson(obj);
        case ObjectPropertyMatchConstraint.name:
            return ObjectPropertyMatchConstraint.fromJson(obj);
        default:
            throw new Error(`Unkown match constraint: ${obj['constraint_name']}`);
    }
}

export abstract class AbstractMatchConstraint {
    abstract scoreElementPair(leftElement: any, rightElement: any): number;

    public matchArrayElements(leftArray: any[], rightArray: any[]): MatchReport {
        let report: MatchReport = {
            matchedIndices: [],
            unmatchedLeftIndices: [],
            unmatchedRightIndices: []
        }

        let rightArrayIndices = [...rightArray.keys()];
        for (let leftElementIndex = 0; leftElementIndex < leftArray.length; leftElementIndex++) {
            const leftElement = leftArray[leftElementIndex];
            let topScore = 0, topScoreIndex = -1;
            for (const rightElementIndex of rightArrayIndices) {
                const rightElement = rightArray[rightElementIndex];
                const score = this.scoreElementPair(leftElement, rightElement);
                if (score > topScore) {
                    topScore = score;
                    topScoreIndex = rightElementIndex;
                    if (score == 1) break;
                }
            }
            if (topScoreIndex == -1) {
                report.unmatchedLeftIndices.push(leftElementIndex)
            } else {
                const deleteIndex = rightArrayIndices.indexOf(topScoreIndex)
                rightArrayIndices.splice(deleteIndex, 1);
                report.matchedIndices.push({
                    leftElementIndex: leftElementIndex,
                    rightElementIndex: topScoreIndex
                });
            }
        }

        report.unmatchedRightIndices = rightArrayIndices;

        return report;
    }

    public static fromJson(_: any): AbstractMatchConstraint {
        throw new Error("Not implemented");
    }
}

export class PrimitiveMatchConstraint extends AbstractMatchConstraint {
    matchType: MatchType;

    scoreElementPair(leftElement: any, rightElement: any): number {
        if (this.matchType == 'literal') {
            return leftElement === rightElement ? 1 : 0;
        } else if (this.matchType == 'string-similarity') {
            return jaroWrinkerSimilarity(leftElement, rightElement);
        } else {
            throw new Error("unknown comparison type");
        }
    }

    public constructor(matchType: MatchType) {
        super();
        this.matchType = matchType;
    }

    public static fromJson(obj: any): AbstractMatchConstraint {
        if (!obj.hasOwnProperty('matchType')) {
            throw new Error(`Error decoding object ${obj} into ${ObjectPropertyMatchConstraint.name}`);
        }

        return new PrimitiveMatchConstraint(obj['matchType'] as MatchType);
    }
}

export class ObjectPropertyMatchConstraint extends AbstractMatchConstraint {
    matchType: MatchType;
    propertyName: string;
    secondaryProperties?: string;
    
    scoreElementPair(leftElement: any, rightElement: any): number {
        if (this.secondaryProperties) {
            for (const secondaryProperty of this.secondaryProperties) {
                if (leftElement[secondaryProperty] !== rightElement[secondaryProperty]) {
                    return 0;
                }
            }
        }

        try {
            let leftSubProperty = resolvePointer(leftElement, this.propertyName);
            let rightSubProperty = resolvePointer(rightElement, this.propertyName);

            if (this.matchType == 'literal') {
                return leftSubProperty == rightSubProperty ? 1 : 0;
            } else if (this.matchType == 'string-similarity') {
                return jaroWrinkerSimilarity(leftSubProperty, rightSubProperty);
            } else {
                throw new Error("unknown comparison type");
            }
        } catch (error) {
            return 0;
        }
    }

    public constructor(matchType: MatchType, propertyName: string, secondaryProperties?: string) {
        super();
        this.matchType = matchType;
        this.propertyName = propertyName;
        this.secondaryProperties = secondaryProperties;
    }

    public static fromJson(obj: any): AbstractMatchConstraint {
        if (!obj.hasOwnProperty('matchType') || !obj.hasOwnProperty('propertyName')) {
            throw new Error(`Error decoding object ${obj} into ${ObjectPropertyMatchConstraint.name}`);
        }

        return new ObjectPropertyMatchConstraint(obj['matchType'] as MatchType, obj['propertyName'], obj['secondaryProperties']);
    }
}
