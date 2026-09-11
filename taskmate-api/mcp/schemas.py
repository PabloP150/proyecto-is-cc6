"""Pydantic models for the `analyze_repository` contract between Node and Python.

Input models are lenient (malformed items are dropped, missing fields get defaults) because the
snapshot is assembled from third-party repository data. Output models are strict: they describe
exactly the plan shape Node receives.
"""
from typing import Any, List, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, field_validator

CATEGORIES = ('frontend', 'backend', 'database', 'testing', 'general')
HARD_MAX_TASKS = 12
HARD_MAX_MILESTONES = 5
NAME_MAX = 25
DESCRIPTION_MAX = 1000
SUMMARY_MAX = 600
INSTRUCTIONS_MAX = 500
KEY_MAX = 40
DATE_PATTERN = r'^\d{4}-\d{2}-\d{2}$'


class _Lenient(BaseModel):
    model_config = ConfigDict(extra='ignore', coerce_numbers_to_str=True)


def _valid_items(model, value: Any, limit: int) -> list:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        if len(items) >= limit:
            break
        try:
            items.append(model.model_validate(item))
        except ValidationError:
            continue
    return items


def _strings(value: Any, limit: int) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, (str, int, float))][:limit]


def _text(value: Any) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ''
    return str(value)


# ---------------------------------------------------------------- input (Node -> Python)

class RepoInfo(_Lenient):
    fullName: str = ''
    defaultBranch: str = ''
    description: str = ''
    language: str = ''

    @field_validator('*', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)


class Manifest(_Lenient):
    path: str
    excerpt: str = ''

    @field_validator('excerpt', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)


class Commit(_Lenient):
    sha7: str = ''
    message: str
    date: str = ''

    @field_validator('sha7', 'date', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)


class Issue(_Lenient):
    number: Optional[int] = None
    title: str


class RepoSnapshot(_Lenient):
    repo: RepoInfo = Field(default_factory=RepoInfo)
    tree: List[str] = Field(default_factory=list)
    readme: str = ''
    manifests: List[Manifest] = Field(default_factory=list)
    commits: List[Commit] = Field(default_factory=list)
    issues: List[Issue] = Field(default_factory=list)

    @field_validator('repo', mode='before')
    @classmethod
    def _repo(cls, value):
        return value if isinstance(value, dict) else {}

    @field_validator('tree', mode='before')
    @classmethod
    def _tree(cls, value):
        return _strings(value, 2000)

    @field_validator('readme', mode='before')
    @classmethod
    def _readme(cls, value):
        return _text(value)

    @field_validator('manifests', mode='before')
    @classmethod
    def _manifests(cls, value):
        return _valid_items(Manifest, value, 20)

    @field_validator('commits', mode='before')
    @classmethod
    def _commits(cls, value):
        return _valid_items(Commit, value, 100)

    @field_validator('issues', mode='before')
    @classmethod
    def _issues(cls, value):
        return _valid_items(Issue, value, 100)


class ExistingTask(_Lenient):
    name: str
    list: str = ''
    percentage: Optional[float] = None

    @field_validator('list', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)

    @field_validator('percentage', mode='before')
    @classmethod
    def _as_number(cls, value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None


class ExistingMilestone(_Lenient):
    name: str
    date: str = ''
    completed: Optional[bool] = None

    @field_validator('date', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)

    @field_validator('completed', mode='before')
    @classmethod
    def _as_bool(cls, value):
        return value if isinstance(value, bool) else None


class ExistingWork(_Lenient):
    tasks: List[ExistingTask] = Field(default_factory=list)
    milestones: List[ExistingMilestone] = Field(default_factory=list)

    @field_validator('tasks', mode='before')
    @classmethod
    def _tasks(cls, value):
        return _valid_items(ExistingTask, value, 5000)

    @field_validator('milestones', mode='before')
    @classmethod
    def _milestones(cls, value):
        return _valid_items(ExistingMilestone, value, 1000)


class Limits(_Lenient):
    maxTasks: int = HARD_MAX_TASKS
    maxMilestones: int = HARD_MAX_MILESTONES

    @field_validator('maxTasks', mode='before')
    @classmethod
    def _tasks(cls, value):
        return _clamp_int(value, HARD_MAX_TASKS)

    @field_validator('maxMilestones', mode='before')
    @classmethod
    def _milestones(cls, value):
        return _clamp_int(value, HARD_MAX_MILESTONES)


def _clamp_int(value: Any, hard_max: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return hard_max
    return max(1, min(hard_max, number))


class AnalyzeRepositoryParams(_Lenient):
    groupId: str = ''
    instructions: str = ''
    today: str = ''
    limits: Limits = Field(default_factory=Limits)
    snapshot: RepoSnapshot = Field(default_factory=RepoSnapshot)
    existing: ExistingWork = Field(default_factory=ExistingWork)

    @field_validator('groupId', 'instructions', 'today', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)

    @field_validator('limits', 'snapshot', 'existing', mode='before')
    @classmethod
    def _as_object(cls, value):
        return value if isinstance(value, dict) else {}


# ---------------------------------------------------------------- raw LLM output (lenient)

class LLMMilestone(_Lenient):
    key: str = Field(default='', validation_alias=AliasChoices('key', 'id', 'milestone_key'))
    name: str = Field(default='', validation_alias=AliasChoices('name', 'title'))
    description: str = ''
    target_date: str = Field(default='', validation_alias=AliasChoices('target_date', 'date', 'due_date'))

    @field_validator('key', 'name', 'description', 'target_date', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)


class LLMTask(_Lenient):
    name: str = Field(default='', validation_alias=AliasChoices('name', 'title'))
    description: str = ''
    milestone_key: str = Field(default='', validation_alias=AliasChoices('milestone_key', 'milestone', 'milestone_id'))
    due_date: str = Field(default='', validation_alias=AliasChoices('due_date', 'date', 'target_date'))
    category: str = ''

    @field_validator('name', 'description', 'milestone_key', 'due_date', 'category', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)


class LLMPlan(_Lenient):
    summary: str = ''
    milestones: List[LLMMilestone] = Field(default_factory=list)
    tasks: List[LLMTask] = Field(default_factory=list)

    @field_validator('summary', mode='before')
    @classmethod
    def _as_text(cls, value):
        return _text(value)

    @field_validator('milestones', mode='before')
    @classmethod
    def _milestones(cls, value):
        return _valid_items(LLMMilestone, value, 50)

    @field_validator('tasks', mode='before')
    @classmethod
    def _tasks(cls, value):
        return _valid_items(LLMTask, value, 100)


# ---------------------------------------------------------------- output (Python -> Node)

class PlanMilestone(BaseModel):
    model_config = ConfigDict(extra='forbid')

    key: str = Field(min_length=1, max_length=KEY_MAX)
    name: str = Field(min_length=1, max_length=NAME_MAX)
    description: str = Field(default='', max_length=DESCRIPTION_MAX)
    target_date: str = Field(pattern=DATE_PATTERN)


class PlanTask(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: str = Field(min_length=1, max_length=NAME_MAX)
    description: str = Field(default='', max_length=DESCRIPTION_MAX)
    milestone_key: Optional[str] = None
    due_date: str = Field(pattern=DATE_PATTERN)
    category: Literal['frontend', 'backend', 'database', 'testing', 'general'] = 'general'


class RepoPlan(BaseModel):
    model_config = ConfigDict(extra='forbid')

    summary: str = Field(default='', max_length=SUMMARY_MAX)
    milestones: List[PlanMilestone] = Field(default_factory=list, max_length=HARD_MAX_MILESTONES)
    tasks: List[PlanTask] = Field(default_factory=list, max_length=HARD_MAX_TASKS)
