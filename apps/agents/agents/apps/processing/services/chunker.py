from langchain_text_splitters import RecursiveCharacterTextSplitter


class ChunkerService:
    """Разбиение текста на чанки фиксированного размера с overlap."""

    def __init__(self) -> None:
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=100,
            length_function=len,
        )

    def split(self, text: str) -> list[str]:
        return [c.strip() for c in self.splitter.split_text(text) if c.strip()]
