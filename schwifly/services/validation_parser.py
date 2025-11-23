import re
from typing import Dict, Literal
from pydantic import BaseModel


class ValidationPoint(BaseModel):
    """Single validation point extracted from <validate> tag"""
    id: str  # "1", "2", etc.
    expected_value: str  # Ground truth
    context: str  # Surrounding text for context
    comparison_type: Literal["exact", "semantic"] = "semantic"  # Comparison mode


class ParsedProcess(BaseModel):
    """Result of parsing process with validation tags"""
    modified_process: str  # Process with [BLANK_X] placeholders
    validations: Dict[str, ValidationPoint]  # {"1": ValidationPoint(...)}
    has_validations: bool  # True if any tags found


class ValidationParser:
    """Parser for extracting <validate> tags from process descriptions"""
    
    # Regex pattern to match <validate> tags with optional type attribute
    # Matches: <validate>text</validate> or <validate type="exact">text</validate>
    VALIDATE_TAG_PATTERN = re.compile(
        r'<validate(?:\s+type="(exact|semantic)")?\s*>(.*?)</validate>',
        re.DOTALL
    )
    
    def parse_process(self, process: str) -> ParsedProcess:
        """
        Extract validation tags and create modified process.
        
        Supports tag attributes: <validate type="exact|semantic">
        Default type is "semantic" if not specified.
        
        Args:
            process: Process description with optional <validate> tags
            
        Returns:
            ParsedProcess with modified process and extracted validations
        """
        validations: Dict[str, ValidationPoint] = {}
        modified_process = process
        blank_counter = 1
        
        # Find all validation tags
        matches = list(self.VALIDATE_TAG_PATTERN.finditer(process))
        
        if not matches:
            return ParsedProcess(
                modified_process=process,
                validations={},
                has_validations=False
            )
        
        # Process matches in reverse order to maintain correct string positions
        for match in reversed(matches):
            comparison_type = match.group(1) or "semantic"  # Default to semantic
            expected_value = match.group(2).strip()
            
            # Get context (surrounding text)
            start_pos = max(0, match.start() - 50)
            end_pos = min(len(process), match.end() + 50)
            context = process[start_pos:end_pos]
            
            # Create validation point
            validation_id = str(len(matches) - blank_counter + 1)
            validations[validation_id] = ValidationPoint(
                id=validation_id,
                expected_value=expected_value,
                context=context,
                comparison_type=comparison_type  # type: ignore
            )
            
            # Replace tag with placeholder
            placeholder = f"[BLANK_{validation_id}]"
            modified_process = (
                modified_process[:match.start()] + 
                placeholder + 
                modified_process[match.end():]
            )
            
            blank_counter += 1
        
        return ParsedProcess(
            modified_process=modified_process,
            validations=validations,
            has_validations=True
        )
