"""Teaching example: a small face classifier and a PyTorch training loop.

Requires PyTorch. Call train_baseline with prepared train/validation DataLoaders.
Each batch must contain float RGB images shaped [N, 3, 112, 112], normalized
to [-1, 1], and int64 labels mapped to 0..num_classes-1.

Validation here measures classification of NEW IMAGES of TRAINING identities.
It is a debugging baseline, not verification on unseen people. Reserve separate
identities for later embedding-based validation and final testing.
"""

from pathlib import Path

import torch
from torch import nn


class SmallFaceClassifier(nn.Module):
    """Small educational CNN; not an ArcFace model or a production recognizer."""

    def __init__(self, num_classes):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)), nn.Flatten(),
            nn.Linear(128 * 4 * 4, 128),
        )
        self.classifier = nn.Linear(128, num_classes)

    def forward(self, images):
        return self.classifier(self.features(images))


def run_epoch(model, loader, criterion, device, optimizer=None):
    training = optimizer is not None
    model.train(training)
    total_loss = correct = count = 0

    with torch.set_grad_enabled(training):
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            if training:
                optimizer.zero_grad(set_to_none=True)

            logits = model(images)
            loss = criterion(logits, labels)
            if training:
                loss.backward()
                optimizer.step()

            total_loss += loss.item() * len(labels)
            correct += (logits.argmax(dim=1) == labels).sum().item()
            count += len(labels)

    if count == 0:
        raise ValueError("The data loader contains no examples")
    return total_loss / count, correct / count


def train_baseline(train_loader, val_loader, class_labels, epochs=5,
                   output="data/models/basic_classifier.pt"):
    """class_labels[i] is the original CASIA identity for training target i.

    Example (after creating loaders with a shared label mapping):
        model = train_baseline(train_loader, val_loader, class_labels)

    Validation loader must use the same class mapping and no random augmentation.
    """
    if epochs < 1 or len(class_labels) < 2:
        raise ValueError("Use at least one epoch and two classes")
    torch.manual_seed(42)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SmallFaceClassifier(len(class_labels)).to(device)
    criterion = nn.CrossEntropyLoss()  # Expects raw logits; no softmax needed.
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    best_loss = float("inf")
    history = []

    print(f"Training on {device}")
    for epoch in range(epochs):
        train_loss, train_acc = run_epoch(
            model, train_loader, criterion, device, optimizer
        )
        val_loss, val_acc = run_epoch(model, val_loader, criterion, device)
        history.append(dict(epoch=epoch + 1, train_loss=train_loss,
                            train_accuracy=train_acc, val_loss=val_loss,
                            val_accuracy=val_acc))
        print(f"Epoch {epoch + 1}: train loss={train_loss:.4f}, "
              f"val loss={val_loss:.4f}, val accuracy={val_acc:.1%}")
        if val_loss < best_loss:
            best_loss = val_loss
            torch.save({"model_state": model.state_dict(),
                        "class_labels": [int(label) for label in class_labels],
                        "epoch": epoch + 1, "val_loss": val_loss,
                        "normalization": "RGB / 127.5 - 1.0",
                        "image_size": [112, 112]}, output)

    checkpoint = torch.load(output, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    return model, history
